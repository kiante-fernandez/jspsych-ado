// Manual smoke test: real Stan WASM inference + ADO loop. Three checks:
//   1. recovery across a (k, tau) sweep      — k recovers within a factor of 5
//   2. tau ordering                          — recovered tau rises with true tau
//   3. precision improves with more trials   — posterior SD of k shrinks as N grows
//
// This is NOT part of `node --test` because it loads the BROWSER wasm module
// (compiled with -sENVIRONMENT=web) in node by shimming `fetch` for file: URLs.
// It exercises the full pipeline the browser uses minus the Web Worker: the
// hyperbolic.stan model, buildData, paramName extraction, summarizeDraws, MI design
// selection, and the (model-agnostic) simulator drawing from model.responseProb.
// All seeds are fixed, so the numbers below are deterministic across runs.
//
// Run:  node tests/js/stan_recovery.smoke.mjs

import "./_wasm_node_shim.mjs";

// Make the web-only emscripten module loadable in node: pretend we are in a web
// environment and teach fetch to read the sibling .wasm from disk.

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const hyp = (await import("../../src/models/hyperbolic/model.js")).default;
const { enumerateDesigns, selectOptimalDesign, summarizeDraws, samplePriorDraws } =
  await import("../../src/ado/mi_engine.js");
const { createSeededRng, simulateCategoricalChoice } =
  await import("../../src/ado/ado_simulation.js");
const { default_dd_config } = await import("../../demos/delay_discounting/dd_config.js");
const delayDiscountingTask = (await import("../../src/tasks/delay_discounting/task.js")).default;

const { makeStanDataBuilder } = await import("../../src/ado/stan_data.js");
// The model declares a stanData map; generate its buildData (the framework does this
// in buildAdapter — done here directly since this smoke bypasses the facade/worker).
const buildData = makeStanDataBuilder({ stanData: hyp.stanData, responseSpace: hyp.responseSpace });

const createModule = (await import(hyp.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

const designs = enumerateDesigns(delayDiscountingTask.design_grid);
const sample_config = { ...default_dd_config.stan };

/**
 * Run the adaptive loop against a simulated participant with the given true
 * parameters and return the recovered posterior means and SDs.
 */
function runRecovery(trueParams, seed, nTrials) {
  const prior_rng = createSeededRng(seed);
  const sim_rng = createSeededRng(seed + 1);
  const sim_config = { params: trueParams, rt: { choice: 0 } };

  let { design } = selectOptimalDesign(
    designs,
    samplePriorDraws(hyp.prior, 2000, prior_rng),
    hyp.responseProb,
  );
  const trials = [];
  let summary = { post_mean: null, post_sd: null };

  for (let t = 0; t < nTrials; t++) {
    const sim = simulateCategoricalChoice(design, sim_config, sim_rng, hyp);
    trials.push({ ...design, choice: sim.response });

    const fit = model.sample({ data: buildData(trials), ...sample_config });
    const ki = fit.paramNames.indexOf("k");
    const ti = fit.paramNames.indexOf("tau");
    const draws = fit.draws[ki].map((k, s) => ({ k, tau: fit.draws[ti][s] }));

    summary = summarizeDraws(draws, hyp.params);
    ({ design } = selectOptimalDesign(designs, draws, hyp.responseProb));
  }
  return summary;
}

let failures = 0;
const fail = (msg) => {
  console.log("  FAIL: " + msg);
  failures++;
};

// --- 1. Recovery across a (k, tau) sweep ------------------------------------
const SWEEP_TRIALS = 30;
const settings = [
  { sweep: "k", k: 1e-4, tau: 2.5 },
  { sweep: "k", k: 1e-3, tau: 2.5 },
  { sweep: "k", k: 1e-2, tau: 2.5 },
  { sweep: "tau", k: 5e-3, tau: 0.5 },
  { sweep: "tau", k: 5e-3, tau: 2.5 },
  { sweep: "tau", k: 5e-3, tau: 5.0 },
];

console.log(`\n[1] Recovery across settings (${SWEEP_TRIALS} adaptive trials each)\n`);
console.log("sweep | true k    true tau | rec k     rec tau | k within 5x?");
console.log("------+--------------------+-------------------+-------------");

let seed = 100;
const results = [];
for (const s of settings) {
  const rec = runRecovery({ k: s.k, tau: s.tau }, seed, SWEEP_TRIALS).post_mean;
  seed += 10;
  const k_ok = Math.abs(Math.log(rec.k) - Math.log(s.k)) < Math.log(5);
  if (!k_ok) fail(`k off for true k=${s.k}: recovered ${rec.k}`);
  results.push({ ...s, rec });
  console.log(
    `${s.sweep.padEnd(5)} | ${s.k.toExponential(1).padEnd(9)} ${String(s.tau).padEnd(8)} | ` +
      `${rec.k.toExponential(1).padEnd(9)} ${rec.tau.toFixed(2).padEnd(7)} | ${k_ok ? "yes" : "NO"}`,
  );
}

// --- 2. tau ordering: recovered tau rises with true tau ---------------------
console.log("\n[2] tau ordering (k fixed at 5e-3): recovered tau should rise with true tau");
const tau_rows = results.filter((r) => r.sweep === "tau").sort((a, b) => a.tau - b.tau);
console.log("  true tau: " + tau_rows.map((r) => r.tau).join(" < "));
console.log("  rec  tau: " + tau_rows.map((r) => r.rec.tau.toFixed(2)).join("   "));
for (let i = 1; i < tau_rows.length; i++) {
  if (!(tau_rows[i].rec.tau > tau_rows[i - 1].rec.tau)) {
    fail(
      `tau not increasing: true ${tau_rows[i - 1].tau}->${tau_rows[i].tau} gave ` +
        `${tau_rows[i - 1].rec.tau.toFixed(2)}->${tau_rows[i].rec.tau.toFixed(2)}`,
    );
  }
}

// --- 3. Precision improves with more trials --------------------------------
console.log("\n[3] Precision vs trials (true k=5e-3, tau=2.5): posterior SD of k should shrink");
const trial_counts = [8, 24, 40];
const sds = trial_counts.map((n) => runRecovery({ k: 5e-3, tau: 2.5 }, 500, n).post_sd.k);
trial_counts.forEach((n, i) =>
  console.log(`  N=${String(n).padStart(2)} trials -> sd(k) = ${sds[i].toExponential(3)}`),
);
for (let i = 1; i < sds.length; i++) {
  if (!(sds[i] < sds[i - 1])) {
    fail(
      `sd(k) did not shrink from N=${trial_counts[i - 1]} to N=${trial_counts[i]}: ` +
        `${sds[i - 1].toExponential(3)} -> ${sds[i].toExponential(3)}`,
    );
  }
}

console.log(failures === 0 ? "\nPASS: all checks passed." : `\nFAIL: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
