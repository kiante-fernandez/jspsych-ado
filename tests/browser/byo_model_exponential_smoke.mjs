// Headless end-to-end smoke for the "bring your own model" demo: the packaged
// delay-discounting task fit with the demo's own authored-and-committed exponential
// model (demos/byo_model_exponential/), driven through the real Web Worker + WASM.
// Confirms a demo-authored model registers and runs end-to-end (the node recovery +
// parity smokes cover the model's correctness; this covers the demo PAGE).
//
// Run:  node tests/browser/byo_model_exponential_smoke.mjs   (needs puppeteer)
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/byo_model_exponential/index.html";
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
      () => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const allRows = jp.data
          .get()
          .values()
          .map((r) => r.value || r);
        const rows = jp.data.get().filter({ task: "delay_discounting" }).values();
        const updateRows = allRows.filter((r) => r.ado_event === "update");
        const errored = allRows.find((r) => r.ado_event === "error" || r.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        if (rows.length < 42 || updateRows.length < 42) return false;
        const last = rows[rows.length - 1];
        return {
          errored: false,
          choiceRows: rows.length,
          modelId: last.model_id ?? null,
          controllerMode: last.controller_mode,
          postMeanK: last.post_mean_k ?? null,
          postSdK: last.post_sd_k ?? null,
          postMeanTau: last.post_mean_tau ?? null,
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
      note(r.modelId === "exponential", `${mode}: model_id is exponential (got ${r.modelId})`);
      note(
        r.controllerMode === mode,
        `${mode}: controller_mode recorded (got ${r.controllerMode})`,
      );
      if (mode === "stan") {
        note(
          typeof r.postMeanK === "number" &&
            typeof r.postSdK === "number" &&
            typeof r.postMeanTau === "number",
          `${mode}: posterior populated (k mean=${r.postMeanK}, sd=${r.postSdK}; tau mean=${r.postMeanTau})`,
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

console.log(
  failures === 0 ? "\nALL BYO-MODEL BROWSER SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
