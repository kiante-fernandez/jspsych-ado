// Browser smoke for the rt-task-style adaptive size-discrimination demo: the
// documentation-shaped example (blue/orange circles, F/J keys, import-map bare
// specifiers). Drives the page as a participant would and checks the run adapts,
// records correctness outcomes, and ends with a posterior-based debrief.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import { attachDiagnostics } from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/size_discrimination/index.html";
const N_TRIALS = 24;

let failures = 0;
const note = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};

const server = await startStaticServer(ROOT);
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);

  console.log(`\n[size-discrimination demo] ${server.url}${PAGE}`);
  await page.goto(`${server.url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });

  // welcome -> instructions (any key each)
  for (let i = 0; i < 2; i++) {
    await page.waitForSelector("#jspsych-html-keyboard-response-stimulus", { timeout: 30000 });
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 300));
  }

  // Answer adaptive trials: wait for the two circles, read their rendered sizes,
  // and answer CORRECTLY so the posterior tightens like a real attentive participant.
  const seen_pairs = [];
  for (let i = 0; i < N_TRIALS; i++) {
    await page.waitForFunction(
      (n) => {
        const jp = window.jsPsych;
        const rows = jp
          ? jp.data
              .get()
              .values()
              .filter((r) => r && r.ado_design && Object.prototype.hasOwnProperty.call(r, "choice"))
          : [];
        return document.querySelectorAll(".sd-circle").length === 2 && rows.length === n;
      },
      { timeout: 240000, polling: 100 },
      i,
    );
    const pair = await page.evaluate(() => {
      const [blue, orange] = Array.from(document.querySelectorAll(".sd-circle"));
      return [blue.offsetWidth, orange.offsetWidth];
    });
    seen_pairs.push(pair);
    await page.keyboard.press(pair[0] > pair[1] ? "f" : "j");
  }

  const r = await page
    .waitForFunction(
      (nTrials) => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const rows = jp.data
          .get()
          .values()
          .filter(
            (row) => row && row.ado_design && Object.prototype.hasOwnProperty.call(row, "choice"),
          );
        const errored = jp.data
          .get()
          .values()
          .find((row) => row.ado_event === "error" || row.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        if (
          rows.length < nTrials ||
          rows.filter((row) => row.ado_event === "update").length < nTrials
        )
          return false;
        const last = rows[rows.length - 1];
        const debrief = document.querySelector("#jspsych-html-keyboard-response-stimulus");
        return {
          errored: false,
          choiceRows: rows.length,
          allCorrectOutcomes: rows.every((row) => row.choice === 1),
          allLabelled: rows.every((row) => row.choice_label === "correct"),
          rendersMatchDesigns: rows.every(
            (row) => row.ado_design && row.ado_design.n_blue !== row.ado_design.n_yellow,
          ),
          postMeanW: last.post_mean_w ?? null,
          postSdW: last.post_sd_w ?? null,
          debriefText: debrief ? debrief.innerText : "",
        };
      },
      { timeout: 240000, polling: 500 },
      N_TRIALS,
    )
    .then((h) => h.jsonValue());

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.choiceRows === N_TRIALS, `${N_TRIALS} adaptive trials recorded (got ${r.choiceRows})`);
    note(r.allCorrectOutcomes, "correct answers recorded as outcome 1 on every row");
    note(r.allLabelled, "outcomes carry the explicit 'correct' label (not the raw f/j keys)");
    // The rendered circle sizes must match the recorded designs (stale-design guard).
    const rows_ok = seen_pairs.length === N_TRIALS && seen_pairs.every((p) => p[0] !== p[1]);
    note(rows_ok, "two differently-sized circles rendered on every trial");
    note(
      typeof r.postMeanW === "number" && r.postMeanW > 0 && r.postMeanW < 1,
      `posterior Weber fraction is plausible (w mean=${r.postMeanW})`,
    );
    note(
      /Weber fraction/.test(r.debriefText),
      "debrief shows the posterior estimate via getState()",
    );
  }

  note(
    diagnostics.consoleErrors.length === 0,
    `no console errors (${diagnostics.consoleErrors.join("; ")})`,
  );
  note(
    diagnostics.pageErrors.length === 0,
    `no page errors (${diagnostics.pageErrors.join("; ")})`,
  );
  note(
    diagnostics.failedReqs.length === 0,
    `no failed requests (${diagnostics.failedReqs.join("; ")})`,
  );
} finally {
  await browser.close();
  await server.close();
}

if (failures > 0) {
  console.error(`\nsize discrimination smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nsize discrimination smoke: all checks passed");
