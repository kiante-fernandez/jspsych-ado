// Headless browser smoke for the 3IFC categorical task/model path. Drives a
// simulated participant through the real jsPsych page and checks that every
// supported controller completes with categorical choices and posterior fields.
//
// Run: node tests/browser/line_length_discrimination_smoke.mjs
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/experiments/line_length_discrimination/index.html";
const TASK = "line_length_discrimination_3ifc";
const BENIGN = [/jatos\.js$/, /favicon\.ico$/];
const isBenign = (url) => BENIGN.some((re) => re.test(url));

async function runMode(browser, baseUrl, spec) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const consoleMessages = [];
  const pageErrors = [];
  const failedReqs = [];

  page.on("console", (msg) => {
    consoleMessages.push(msg.text());
    if (msg.type() !== "error") return;
    if (/Failed to load resource/i.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (!isBenign(req.url())) failedReqs.push(`${req.url()} (${req.failure()?.errorText})`);
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !isBenign(resp.url())) failedReqs.push(`${resp.url()} (HTTP ${resp.status()})`);
  });

  await page.goto(`${baseUrl}${PAGE}?${spec.query}&simulate=data-only&debug=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const result = await page.waitForFunction((task) => {
	    const jp = window.jsPsych;
	    if (!jp || !jp.data) return false;
	    const allRows = jp.data.get().values();
	    const eventRows = allRows.map((row) => row.value || row);
	    const rows = allRows.filter((row) => row.task === task);
	    const updates = eventRows.filter((row) => row.ado_event === "update");
	    const errored = eventRows.find((row) => row.ado_event === "error" || row.ado_error);
	    if (errored) return { errored: true, message: errored.ado_error || "unknown" };
	    if (rows.length < 18 || updates.length < 18) return false;
	    const last = rows[rows.length - 1];
	    const hasChoiceMi = Object.prototype.hasOwnProperty.call(last, "ado_mutual_info");
	    const hasChoiceSelectionTime = Object.prototype.hasOwnProperty.call(last, "ado_selection_time_ms");
	    return {
	      errored: false,
	      choiceRows: rows.length,
	      updateRows: updates.length,
	      hasAdoDesign: !!last.ado_design && typeof last.ado_design === "object",
	      hasChoiceMi,
	      hasChoiceSelectionTime,
	      choice: last.choice,
	      choiceMutualInfo: last.ado_mutual_info ?? null,
	      choiceSelectionTime: last.ado_selection_time_ms ?? null,
	      choiceLabel: last.choice_label,
	      postMeanSensitivity: last.post_mean_sensitivity ?? null,
      postSdSensitivity: last.post_sd_sensitivity ?? null,
      postMeanBiasB: last.post_mean_bias_b ?? null,
      postSdBiasB: last.post_sd_bias_b ?? null,
      postMeanBiasC: last.post_mean_bias_c ?? null,
      postSdBiasC: last.post_sd_bias_c ?? null,
      simPA: last.sim_p_a ?? null,
      simPB: last.sim_p_b ?? null,
      simPC: last.sim_p_c ?? null,
	      simDraw: last.sim_draw ?? null,
	      controllerMode: last.controller_mode,
	      designStrategy: last.design_strategy ?? null,
	      updateRowsWithMetrics: updates.filter((row) => Array.isArray(row.ado_next_design_metrics)).length,
	    };
  }, { timeout: spec.timeout, polling: 500 }, TASK).then((h) => h.jsonValue());

  await page.close();
  return { mode: spec.label, result, consoleMessages, consoleErrors, pageErrors, failedReqs };
}

let failures = 0;
const note = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`); if (!ok) failures++; };

const server = await startStaticServer(ROOT);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });

try {
  const specs = [
    { label: "mock", query: "controller=mock", timeout: 60000 },
    { label: "stan", query: "controller=stan&strategy=ado", timeout: 240000 },
    { label: "random", query: "controller=stan&strategy=random", timeout: 240000 },
    { label: "quest_plus", query: "controller=quest_plus", timeout: 60000 },
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
    note(!r.errored, r.errored ? `${mode}: controller error -> ${r.message}` : `${mode}: completed without controller error`);
    if (!r.errored) {
	      note(r.choiceRows === 18, `${mode}: 18 choice trials recorded (got ${r.choiceRows})`);
	      note(r.updateRows === 18, `${mode}: 18 update rows recorded (got ${r.updateRows})`);
	      note(r.hasAdoDesign, `${mode}: last row carries ado_design`);
	      note(r.hasChoiceMi, `${mode}: choice row carries ado_mutual_info`);
	      note(r.hasChoiceSelectionTime, `${mode}: choice row carries ado_selection_time_ms`);
	      note(r.updateRowsWithMetrics === 18, `${mode}: update rows carry ado_next_design_metrics`);
	      note([0, 1, 2].includes(r.choice), `${mode}: choice is 0/1/2 (got ${r.choice})`);
	      note(["A", "B", "C"].includes(r.choiceLabel), `${mode}: choice label is A/B/C (got ${r.choiceLabel})`);
      note(r.controllerMode === (mode === "quest_plus" ? "quest_plus" : (mode === "random" ? "stan" : mode)),
        `${mode}: controller_mode recorded (got ${r.controllerMode})`);
	      note(typeof r.simPA === "number" && typeof r.simPB === "number" &&
	        typeof r.simPC === "number" && typeof r.simDraw === "number",
	        `${mode}: simulation probability audit fields populated`);
	      if (mode === "stan") {
	        note(typeof r.choiceMutualInfo === "number" && Number.isFinite(r.choiceMutualInfo),
	          `${mode}: selected-design MI recorded (${r.choiceMutualInfo})`);
	        note(typeof r.choiceSelectionTime === "number" && r.choiceSelectionTime >= 0,
	          `${mode}: selection time recorded (${r.choiceSelectionTime} ms)`);
	      } else if (mode === "random") {
	        note(r.choiceMutualInfo === null, `${mode}: selected-design MI is null when unavailable`);
	        note(typeof r.choiceSelectionTime === "number" && r.choiceSelectionTime >= 0,
	          `${mode}: selection time recorded (${r.choiceSelectionTime} ms)`);
	      } else {
	        note(r.choiceMutualInfo === null, `${mode}: selected-design MI is null when unavailable`);
	        note(r.choiceSelectionTime === null, `${mode}: selection time is null when unavailable`);
	      }
	      if (mode === "stan" || mode === "random" || mode === "quest_plus") {
        note(typeof r.postMeanSensitivity === "number" && typeof r.postSdSensitivity === "number" &&
          typeof r.postMeanBiasB === "number" && typeof r.postSdBiasB === "number" &&
          typeof r.postMeanBiasC === "number" && typeof r.postSdBiasC === "number",
          `${mode}: posterior populated (sensitivity mean=${r.postMeanSensitivity}, sd=${r.postSdSensitivity})`);
      }
    }
    const questLogs = out.consoleMessages.filter((message) => /jsQuestPlus Version/.test(message));
    if (mode === "quest_plus") {
      note(questLogs.length > 0, `${mode}: Quest+ module loaded`);
    } else {
      note(questLogs.length === 0, `${mode}: Quest+ module not loaded`);
    }
    note(out.consoleErrors.length === 0, `${mode}: no console errors` + (out.consoleErrors.length ? ` -> ${out.consoleErrors.slice(0, 3).join(" | ")}` : ""));
    note(out.pageErrors.length === 0, `${mode}: no uncaught page errors` + (out.pageErrors.length ? ` -> ${out.pageErrors.slice(0, 3).join(" | ")}` : ""));
    note(out.failedReqs.length === 0, `${mode}: no unexpected failed requests` + (out.failedReqs.length ? ` -> ${out.failedReqs.slice(0, 3).join(" | ")}` : ""));
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(failures === 0 ? "\nALL 3IFC BROWSER SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
