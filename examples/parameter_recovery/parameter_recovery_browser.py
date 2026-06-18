"""Run experiment-level parameter recovery through the real jsPsych page.

This helper starts a local static server, opens the experiment in
``simulate=data-only`` mode with Python Playwright, reads the displayed jsPsych
JSON, and normalizes posterior summaries into one long parameter table.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_EXPERIMENT_PATH = "experiments/delay_discounting/index.html"
DEFAULT_MODEL_ID = "hyperbolic"
DEFAULT_CHOICE_TASK_FIELD = "task"
DEFAULT_CHOICE_TASK = "delay_discounting"
DEFAULT_TRIAL_NUMBER_FIELD = "trial_number"
DEFAULT_DESIGN_FIELDS = ["r_ss", "t_ss", "r_ll", "t_ll"]
DEFAULT_RUN_SPECS = [
    {"strategy": "ado", "query": {"controller": "stan", "strategy": "ado"}},
    {"strategy": "random", "query": {"controller": "stan", "strategy": "random"}},
    {"strategy": "quest_plus", "query": {"controller": "quest_plus"}},
]
DEFAULT_STRATEGIES = [spec["strategy"] for spec in DEFAULT_RUN_SPECS]
DEFAULT_SEEDS = [101, 102, 103, 104, 105]
DEFAULT_PARAMETERS = [
    {"name": "k", "scale": "log10", "label": "Discount rate k"},
    {"name": "tau", "scale": "linear", "label": "Choice sensitivity tau"},
]
DEFAULT_SIMULATION_PROFILES = [
    {"profile_id": "k_1e-4", "sweep": "k", "params": {"k": 1e-4, "tau": 2.5}},
    {"profile_id": "k_1e-3", "sweep": "k", "params": {"k": 1e-3, "tau": 2.5}},
    {"profile_id": "k_1e-2", "sweep": "k", "params": {"k": 1e-2, "tau": 2.5}},
    {"profile_id": "tau_0.5", "sweep": "tau", "params": {"k": 5e-3, "tau": 0.5}},
    {"profile_id": "tau_2.5", "sweep": "tau", "params": {"k": 5e-3, "tau": 2.5}},
    {"profile_id": "tau_5.0", "sweep": "tau", "params": {"k": 5e-3, "tau": 5.0}},
]
QUICK_SIMULATION_PROFILES = [
    {"profile_id": "k_1e-3", "sweep": "k", "params": {"k": 1e-3, "tau": 2.5}},
]
QUICK_SEEDS = [101]


class QuietHandler(SimpleHTTPRequestHandler):
    """Static-file handler that suppresses request logs during notebook runs."""

    def log_message(self, format: str, *args: Any) -> None:
        pass


@contextlib.contextmanager
def static_server(repo_root: Path):
    """Serve the repository root on a random local port."""

    handler = partial(QuietHandler, directory=str(repo_root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def get_error(post_mean: float, true_value: float, scale: str) -> float:
    """Return signed recovery error on the requested parameter scale."""

    if scale == "log10":
        return math.log10(post_mean) - math.log10(true_value)
    if scale == "linear":
        return post_mean - true_value
    raise ValueError(f"Unknown parameter scale: {scale}")


def get_displayed_json(page) -> list[dict[str, Any]]:
    """Read the jsPsych JSON rendered by init_experiment.js outside JATOS."""

    page.wait_for_function(
        """() => {
          const text = document.body.innerText.trim();
          return text.startsWith("[") && text.endsWith("]");
        }""",
        timeout=120000,
    )
    text = page.locator("body").inner_text(timeout=5000).strip()
    return json.loads(text)


def make_run_config(profile: dict[str, Any], seed: int) -> dict[str, Any]:
    """Create the injected browser config for one simulated participant."""

    return {
        "simulation": {
            "seed": seed,
            "params": profile["params"],
            "rt": {
                "instructions": 300,
                "choice": 500,
                "end": 300,
            },
        },
        "controller": {
            "design_seed": seed + 10000,
        },
    }


def normalize_run_spec(run_spec: str | dict[str, Any]) -> dict[str, Any]:
    """Return a run spec with a display label and URL query parameters."""

    if isinstance(run_spec, str):
        return {
            "strategy": run_spec,
            "query": {
                "controller": "stan",
                "strategy": run_spec,
            },
        }

    strategy = run_spec["strategy"]
    query = dict(run_spec.get("query", {}))
    if "controller" in run_spec:
        query["controller"] = run_spec["controller"]
    if "design_strategy" in run_spec:
        query["strategy"] = run_spec["design_strategy"]
    return {
        "strategy": strategy,
        "query": query,
    }


def get_run_specs(
    run_specs: list[dict[str, Any]] | None,
    strategies: list[str] | None,
) -> list[dict[str, Any]]:
    """Resolve new run specs, preserving the old strategies fallback."""

    if run_specs is not None:
        return [normalize_run_spec(spec) for spec in run_specs]
    if strategies is not None:
        return [normalize_run_spec(strategy) for strategy in strategies]
    return [normalize_run_spec(spec) for spec in DEFAULT_RUN_SPECS]


def get_choice_rows(
    raw_rows: list[dict[str, Any]],
    choice_task_field: str,
    choice_task: str,
) -> list[dict[str, Any]]:
    """Return the participant choice rows from the displayed jsPsych data."""

    return [row for row in raw_rows if row.get(choice_task_field) == choice_task]


def get_update_rows(raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the ADO update payload rows that follow each choice trial."""

    updates = []
    for row in raw_rows:
        value = row.get("value")
        if isinstance(value, dict) and value.get("ado_event") == "update":
            updates.append(value)
    return updates


def normalize_run(
    raw_rows: list[dict[str, Any]],
    experiment_path: str,
    model_id: str,
    strategy: str,
    profile: dict[str, Any],
    seed: int,
    parameters: list[dict[str, Any]],
    choice_task_field: str,
    choice_task: str,
    trial_number_field: str,
    design_fields: list[str],
) -> list[dict[str, Any]]:
    """Convert one jsPsych run into long-form parameter recovery rows."""

    choice_rows = get_choice_rows(raw_rows, choice_task_field, choice_task)
    update_rows = get_update_rows(raw_rows)
    if len(choice_rows) != len(update_rows):
        raise ValueError(
            f"Expected one ADO update per choice row; got "
            f"{len(choice_rows)} choices and {len(update_rows)} updates."
        )

    normalized = []
    for choice_row, update_row in zip(choice_rows, update_rows):
        post_mean = update_row.get("ado_post_mean") or {}
        post_sd = update_row.get("ado_post_sd") or {}
        for parameter in parameters:
            name = parameter["name"]
            if name not in post_mean or name not in post_sd:
                continue
            true_value = choice_row.get("sim_" + name, profile["params"].get(name))
            if true_value is None:
                continue
            scale = parameter.get("scale", "linear")
            error = get_error(float(post_mean[name]), float(true_value), scale)
            normalized.append({
                "experiment_path": experiment_path,
                "model_id": model_id,
                "strategy": strategy,
                "profile_id": profile["profile_id"],
                "sweep": profile.get("sweep"),
                "seed": seed,
                "trial_number": choice_row.get(trial_number_field),
                "parameter": name,
                "parameter_label": parameter.get("label", name),
                "parameter_scale": scale,
                "true_value": true_value,
                "post_mean": post_mean[name],
                "post_sd": post_sd[name],
                "error": error,
                "abs_error": abs(error),
                "choice": choice_row.get("choice"),
                "choice_label": choice_row.get("choice_label"),
                "sim_p_ll": choice_row.get("sim_p_ll"),
                "sim_draw": choice_row.get("sim_draw"),
                "ado_mode": choice_row.get("ado_mode"),
                "controller_mode": choice_row.get("controller_mode"),
                "design_strategy": choice_row.get("design_strategy"),
                "ado_trial_index": choice_row.get("ado_trial_index"),
                "choice_task_field": choice_task_field,
                "choice_task": choice_task,
                "design": choice_row.get("ado_design"),
                "ado_next_design": update_row.get("ado_next_design"),
                "ado_api_latency_ms": update_row.get("ado_api_latency_ms"),
            })
            for field in design_fields:
                normalized[-1][field] = choice_row.get(field)
    return normalized


def run_browser_grid(
    base_url: str,
    experiment_path: str,
    model_id: str,
    run_specs: list[dict[str, Any]],
    simulation_profiles: list[dict[str, Any]],
    seeds: list[int],
    parameters: list[dict[str, Any]],
    choice_task_field: str,
    choice_task: str,
    trial_number_field: str,
    design_fields: list[str],
    include_raw: bool = False,
) -> dict[str, Any]:
    """Run every strategy/profile/seed combination in a real browser."""

    rows = []
    raw_runs = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for run_spec in run_specs:
                strategy = run_spec["strategy"]
                for profile in simulation_profiles:
                    for seed in seeds:
                        page = browser.new_page()
                        run_config = make_run_config(profile, seed)
                        page.add_init_script(
                            "window.__JSPSYCH_ADO_RUN_CONFIG__ = " + json.dumps(run_config) + ";"
                        )
                        query_params = dict(run_spec["query"])
                        query_params["simulate"] = "data-only"
                        query = urlencode(query_params)
                        page.goto(f"{base_url}/{experiment_path}?{query}", wait_until="domcontentloaded")
                        raw_rows = get_displayed_json(page)
                        page.close()
                        rows.extend(
                            normalize_run(
                                raw_rows,
                                experiment_path,
                                model_id,
                                strategy,
                                profile,
                                seed,
                                parameters,
                                choice_task_field,
                                choice_task,
                                trial_number_field,
                                design_fields,
                            )
                        )
                        if include_raw:
                            raw_runs.append({
                                "strategy": strategy,
                                "profile_id": profile["profile_id"],
                                "seed": seed,
                                "rows": raw_rows,
                            })
        finally:
            browser.close()

    return {
        "rows": rows,
        "raw_runs": raw_runs,
    }


def run_recovery(
    experiment_path: str = DEFAULT_EXPERIMENT_PATH,
    model_id: str = DEFAULT_MODEL_ID,
    run_specs: list[dict[str, Any]] | None = None,
    strategies: list[str] | None = None,
    simulation_profiles: list[dict[str, Any]] | None = None,
    seeds: list[int] | None = None,
    parameters: list[dict[str, Any]] | None = None,
    choice_task_field: str = DEFAULT_CHOICE_TASK_FIELD,
    choice_task: str = DEFAULT_CHOICE_TASK,
    trial_number_field: str = DEFAULT_TRIAL_NUMBER_FIELD,
    design_fields: list[str] | None = None,
    repo_root: Path = REPO_ROOT,
    quick: bool = False,
    include_raw: bool = False,
) -> dict[str, Any]:
    """Run the configured experiment-level recovery audit and return JSON data."""

    run_specs = get_run_specs(run_specs, strategies)
    strategies = [spec["strategy"] for spec in run_specs]
    if parameters is None:
        parameters = DEFAULT_PARAMETERS
    if simulation_profiles is None:
        simulation_profiles = QUICK_SIMULATION_PROFILES if quick else DEFAULT_SIMULATION_PROFILES
    if seeds is None:
        seeds = QUICK_SEEDS if quick else DEFAULT_SEEDS
    if design_fields is None:
        design_fields = DEFAULT_DESIGN_FIELDS

    with static_server(repo_root) as base_url:
        result = run_browser_grid(
            base_url,
            experiment_path,
            model_id,
            run_specs,
            simulation_profiles,
            seeds,
            parameters,
            choice_task_field,
            choice_task,
            trial_number_field,
            design_fields,
            include_raw=include_raw,
        )

    metadata = {
        "experiment_path": experiment_path,
        "model_id": model_id,
        "run_specs": run_specs,
        "strategies": strategies,
        "simulation_profiles": simulation_profiles,
        "seeds": seeds,
        "parameters": parameters,
        "choice_task_field": choice_task_field,
        "choice_task": choice_task,
        "trial_number_field": trial_number_field,
        "design_fields": design_fields,
        "trial_count": len(result["rows"]) // max(1, len(strategies) * len(simulation_profiles) * len(seeds) * len(parameters)),
        "quick": quick,
    }
    return {
        "metadata": metadata,
        "rows": result["rows"],
        "raw_runs": result["raw_runs"],
    }


def parse_args() -> argparse.Namespace:
    """Parse CLI options for quick notebook-helper validation."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="Run one profile and one seed.")
    parser.add_argument("--include-raw", action="store_true", help="Include raw jsPsych rows in JSON output.")
    parser.add_argument(
        "--settings-json",
        help="JSON object with run_recovery keyword overrides, used by the notebook template.",
    )
    return parser.parse_args()


def main() -> None:
    """CLI entry point used by the smoke check."""

    args = parse_args()
    settings = json.loads(args.settings_json) if args.settings_json else {}
    if "repo_root" in settings:
        settings["repo_root"] = Path(settings["repo_root"])
    payload = run_recovery(quick=args.quick, include_raw=args.include_raw, **settings)
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
