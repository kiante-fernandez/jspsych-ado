// Headless end-to-end smoke for the in-browser Worker + WASM path — the one
// surface the node unit tests cannot reach (they bypass the Web Worker). Drives a
// simulated participant (data-only) through the delay-discounting page for the
// supported controllers and asserts the full pipeline runs:
//   - mock: generic timeline + data flow, no WASM
//   - stan: the in-browser Stan Web Worker + WASM path (NUTS off the main thread)
//   - random: the same Stan path with random design selection
// Fails on any console error / page error / unexpected failed request, or if a run
// does not complete 42 choice trials with populated posteriors (stan).
//
// Run:  node tests/browser/dd_smoke.mjs   (needs `npm install` for puppeteer)
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/delay_discounting/index.html";
const BENIGN = [/favicon\.ico$/];
const isBenign = (url) => BENIGN.some((re) => re.test(url));

async function runMode(browser, baseUrl, spec) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // "Failed to load resource: 404" carries no URL; covered by the response check.
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
      () => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const allRows = jp.data.get().values();
        const rows = jp.data.get().filter({ task: "delay_discounting" }).values();
        const eventRows = allRows.map((r) => r.value || r);
        const updateRows = eventRows.filter((r) => r.ado_event === "update");
        const errored = eventRows.find((r) => r.ado_event === "error" || r.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        if (rows.length < 42 || updateRows.length < 42) return false;
        const last = rows[rows.length - 1];
        const hasChoiceMi = Object.prototype.hasOwnProperty.call(last, "ado_mutual_info");
        const hasChoiceSelectionTime = Object.prototype.hasOwnProperty.call(
          last,
          "ado_selection_time_ms",
        );
        return {
          errored: false,
          choiceRows: rows.length,
          updateRows: updateRows.length,
          hasAdoDesign: !!last.ado_design && typeof last.ado_design === "object",
          hasChoiceMi,
          hasChoiceSelectionTime,
          choice: last.choice,
          choiceMutualInfo: last.ado_mutual_info ?? null,
          choiceSelectionTime: last.ado_selection_time_ms ?? null,
          postMeanK: last.post_mean_k ?? null,
          postSdK: last.post_sd_k ?? null,
          postMeanTau: last.post_mean_tau ?? null,
          postSdTau: last.post_sd_tau ?? null,
          controllerMode: last.controller_mode,
          designStrategy: last.design_strategy ?? null,
          updateRowsWithMetrics: updateRows.filter((r) => Array.isArray(r.ado_next_design_metrics))
            .length,
        };
      },
      { timeout: spec.timeout, polling: 500 },
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
      note(r.choiceRows === 42, `${mode}: 42 choice trials recorded (got ${r.choiceRows})`);
      note(r.updateRows === 42, `${mode}: 42 update rows recorded (got ${r.updateRows})`);
      note(r.hasAdoDesign, `${mode}: last row carries ado_design`);
      note(r.hasChoiceMi, `${mode}: choice row carries ado_mutual_info`);
      note(r.hasChoiceSelectionTime, `${mode}: choice row carries ado_selection_time_ms`);
      note(r.updateRowsWithMetrics === 42, `${mode}: update rows carry ado_next_design_metrics`);
      note(r.choice === 0 || r.choice === 1, `${mode}: choice is 0/1 (got ${r.choice})`);
      note(
        r.controllerMode === (mode === "random" ? "stan" : mode),
        `${mode}: controller_mode recorded (got ${r.controllerMode})`,
      );
      if (mode === "stan") {
        note(
          typeof r.choiceMutualInfo === "number" && Number.isFinite(r.choiceMutualInfo),
          `${mode}: selected-design MI recorded (${r.choiceMutualInfo})`,
        );
        note(
          typeof r.choiceSelectionTime === "number" && r.choiceSelectionTime >= 0,
          `${mode}: selection time recorded (${r.choiceSelectionTime} ms)`,
        );
      } else if (mode === "random") {
        note(
          typeof r.choiceMutualInfo === "number" && Number.isFinite(r.choiceMutualInfo),
          `${mode}: selected-design MI recorded for the sampled design (${r.choiceMutualInfo})`,
        );
        note(
          typeof r.choiceSelectionTime === "number" && r.choiceSelectionTime >= 0,
          `${mode}: selection time recorded (${r.choiceSelectionTime} ms)`,
        );
      } else {
        note(r.choiceMutualInfo === null, `${mode}: selected-design MI is null when unavailable`);
        note(r.choiceSelectionTime === null, `${mode}: selection time is null when unavailable`);
      }
      if (mode === "stan" || mode === "random") {
        note(
          typeof r.postMeanK === "number" &&
            typeof r.postSdK === "number" &&
            typeof r.postMeanTau === "number" &&
            typeof r.postSdTau === "number",
          `${mode}: posterior populated (k mean=${r.postMeanK}, sd=${r.postSdK}; tau mean=${r.postMeanTau}, sd=${r.postSdTau})`,
        );
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

console.log(failures === 0 ? "\nALL BROWSER SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
