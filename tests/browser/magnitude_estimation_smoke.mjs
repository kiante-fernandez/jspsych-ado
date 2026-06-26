// Headless browser smoke for the CONTINUOUS-response task/model path (Stevens power
// law via a canvas slider). Drives a simulated participant through the real jsPsych
// page — exercising the Web Worker + WASM path the Node smokes bypass — and checks
// that every supported controller completes with a real-valued response and the
// continuous posterior fields (loga, b, sigma).
//
// Run: node tests/browser/magnitude_estimation_smoke.mjs
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/magnitude_estimation/index.html";
const TASK = "magnitude_estimation";
const N_TRIALS = 20; // matches default_magnitude_estimation_config.n_trials
const BENIGN = [/favicon\.ico$/];
const isBenign = (url) => BENIGN.some((re) => re.test(url));

async function runMode(browser, baseUrl, spec) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource/i.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (!isBenign(req.url())) failedReqs.push(`${req.url()} (${req.failure()?.errorText})`);
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !isBenign(resp.url()))
      failedReqs.push(`${resp.url()} (HTTP ${resp.status()})`);
  });

  await page.goto(`${baseUrl}${PAGE}?${spec.query}&simulate=data-only&debug=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const result = await page
    .waitForFunction(
      (task, nTrials) => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const allRows = jp.data.get().values();
        const eventRows = allRows.map((row) => row.value || row);
        const rows = allRows.filter((row) => row.task === task);
        const updates = eventRows.filter((row) => row.ado_event === "update");
        const errored = eventRows.find((row) => row.ado_event === "error" || row.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        if (rows.length < nTrials || updates.length < nTrials) return false;
        const last = rows[rows.length - 1];
        return {
          errored: false,
          choiceRows: rows.length,
          updateRows: updates.length,
          hasAdoDesign: !!last.ado_design && typeof last.ado_design === "object",
          hasChoiceMi: Object.prototype.hasOwnProperty.call(last, "ado_mutual_info"),
          hasChoiceSelectionTime: Object.prototype.hasOwnProperty.call(
            last,
            "ado_selection_time_ms",
          ),
          choice: last.choice,
          choiceRaw: last.choice_raw ?? null,
          choiceLabel: last.choice_label ?? null,
          choiceMutualInfo: last.ado_mutual_info ?? null,
          choiceSelectionTime: last.ado_selection_time_ms ?? null,
          postMeanLoga: last.post_mean_loga ?? null,
          postMeanB: last.post_mean_b ?? null,
          postSdB: last.post_sd_b ?? null,
          postMeanSigma: last.post_mean_sigma ?? null,
          simB: last.sim_b ?? null,
          simEstimate: last.sim_estimate ?? null,
          controllerMode: last.controller_mode,
          designStrategy: last.design_strategy ?? null,
          updateRowsWithMetrics: updates.filter((row) => Array.isArray(row.ado_next_design_metrics))
            .length,
        };
      },
      { timeout: spec.timeout, polling: 500 },
      TASK,
      N_TRIALS,
    )
    .then((h) => h.jsonValue());

  await page.close();
  return { mode: spec.label, result, consoleErrors, pageErrors, failedReqs };
}

let failures = 0;
const note = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};

const server = await startStaticServer(ROOT);
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const specs = [
    { label: "mock", query: "controller=mock", timeout: 60000 },
    { label: "stan", query: "controller=stan&strategy=ado", timeout: 240000 },
    { label: "random", query: "controller=stan&strategy=random", timeout: 240000 },
  ];
  for (const spec of specs) {
    console.log(`\n[${spec.label}] ${server.url}${PAGE}?${spec.query}&simulate=data-only&debug=1`);
    let out;
    try {
      out = await runMode(browser, server.url, spec);
    } catch (e) {
      note(false, `${spec.label}: run did not complete (${String(e).split("\n")[0]})`);
      continue;
    }
    const r = out.result;
    const mode = spec.label;
    note(
      !r.errored,
      r.errored
        ? `${mode}: controller error -> ${r.message}`
        : `${mode}: completed without controller error`,
    );
    if (!r.errored) {
      note(
        r.choiceRows === N_TRIALS,
        `${mode}: ${N_TRIALS} choice trials recorded (got ${r.choiceRows})`,
      );
      note(
        r.updateRows === N_TRIALS,
        `${mode}: ${N_TRIALS} update rows recorded (got ${r.updateRows})`,
      );
      note(r.hasAdoDesign, `${mode}: last row carries ado_design`);
      note(r.hasChoiceMi, `${mode}: choice row carries ado_mutual_info`);
      note(r.hasChoiceSelectionTime, `${mode}: choice row carries ado_selection_time_ms`);
      note(
        r.updateRowsWithMetrics === N_TRIALS,
        `${mode}: update rows carry ado_next_design_metrics`,
      );
      // Continuous response: choice is a real number (log estimate), not a class index,
      // and there is no categorical label.
      note(
        typeof r.choice === "number" && Number.isFinite(r.choice),
        `${mode}: choice is a finite real number (got ${r.choice})`,
      );
      note(
        typeof r.choiceRaw === "number" && Number.isFinite(r.choiceRaw),
        `${mode}: choice_raw (raw slider estimate) recorded (got ${r.choiceRaw})`,
      );
      note(
        r.choiceLabel === null,
        `${mode}: choice_label is null for a continuous response (got ${r.choiceLabel})`,
      );
      note(
        r.controllerMode === (mode === "random" ? "stan" : mode),
        `${mode}: controller_mode recorded (got ${r.controllerMode})`,
      );
      note(
        typeof r.simB === "number" && typeof r.simEstimate === "number",
        `${mode}: simulation audit fields populated (sim_b=${r.simB}, sim_estimate=${r.simEstimate})`,
      );
      if (mode === "stan" || mode === "random") {
        note(
          typeof r.choiceMutualInfo === "number" && Number.isFinite(r.choiceMutualInfo),
          `${mode}: selected-design MI recorded (${r.choiceMutualInfo})`,
        );
        note(
          typeof r.choiceSelectionTime === "number" && r.choiceSelectionTime >= 0,
          `${mode}: selection time recorded (${r.choiceSelectionTime} ms)`,
        );
        note(
          typeof r.postMeanLoga === "number" &&
            typeof r.postMeanB === "number" &&
            typeof r.postSdB === "number" &&
            typeof r.postMeanSigma === "number",
          `${mode}: continuous posterior populated (b mean=${r.postMeanB}, sd=${r.postSdB}, sigma=${r.postMeanSigma})`,
        );
      } else {
        note(r.choiceMutualInfo === null, `${mode}: selected-design MI is null when unavailable`);
        note(r.choiceSelectionTime === null, `${mode}: selection time is null when unavailable`);
      }
    }
    note(
      out.consoleErrors.length === 0,
      `${mode}: no console errors` +
        (out.consoleErrors.length ? ` -> ${out.consoleErrors.slice(0, 3).join(" | ")}` : ""),
    );
    note(
      out.pageErrors.length === 0,
      `${mode}: no uncaught page errors` +
        (out.pageErrors.length ? ` -> ${out.pageErrors.slice(0, 3).join(" | ")}` : ""),
    );
    note(
      out.failedReqs.length === 0,
      `${mode}: no unexpected failed requests` +
        (out.failedReqs.length ? ` -> ${out.failedReqs.slice(0, 3).join(" | ")}` : ""),
    );
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  failures === 0
    ? "\nALL MAGNITUDE-ESTIMATION BROWSER SMOKE CHECKS PASSED"
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
