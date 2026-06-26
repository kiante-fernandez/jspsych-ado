// Behavioral smoke for EIG-fraction adaptive stopping (#21), with REAL Stan WASM
// inference + the real MI engine. It runs the adaptive loop exactly as the
// controller would — pick the max-EIG design, simulate, refit, evaluate the
// stopping rule on the real grid-max EIG — and checks:
//   1. with stopping ON, an informative run stops BEFORE max_trials (the EIG decays)
//   2. recovery still holds at the early stop (k within a factor of 5)
//   3. a stricter (higher) eig_fraction stops no later than a lenient one
//   4. min_trials is always respected (never stops earlier)
//
// Like the other recovery smokes this loads the web-only WASM in node via a fetch
// shim and bypasses the Web Worker, so it is NOT part of `node --test`.
//
// Run:  node tests/js/stopping_recovery.smoke.mjs

import "./_wasm_node_shim.mjs";

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const hyp = (await import("../../src/models/hyperbolic/model.js")).default;
const { enumerateDesigns, selectOptimalDesign, summarizeDraws, samplePriorDraws } =
  await import("../../src/ado/mi_engine.js");
const { createSeededRng, simulateCategoricalChoice } =
  await import("../../src/ado/ado_simulation.js");
const { makeStanDataBuilder } = await import("../../src/ado/stan_data.js");
const { normalizeStoppingConfig, evaluateStopping, maxPossibleEig } =
  await import("../../src/ado/stopping.js");

const buildData = makeStanDataBuilder({ stanData: hyp.stanData, responseSpace: hyp.responseSpace });
const createModule = (await import(hyp.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

const designs = enumerateDesigns(
  (await import("../../demos/delay_discounting/dd_config.js")).default_dd_config.grid_design ??
    (await import("../../src/tasks/delay_discounting/task.js")).default.design_grid,
);
const sample_config = { num_chains: 2, num_warmup: 300, num_samples: 300, seed: 123 };
const max_possible_eig = maxPossibleEig(hyp.responseSpace); // ln 2

// Run the adaptive loop with the EIG-fraction stopping rule and report where it stopped.
function runWithStopping(trueParams, seed, stopping_raw) {
  const stopping = normalizeStoppingConfig(stopping_raw, stopping_raw.max_trials);
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
  let consecutive_below = 0;
  let stop_reason = null;
  let last_eig = null;

  for (let t = 0; t < stopping.max_trials; t++) {
    const sim = simulateCategoricalChoice(design, sim_config, sim_rng, hyp);
    trials.push({ ...design, choice: sim.response });

    const fit = model.sample({ data: buildData(trials), ...sample_config });
    const ki = fit.paramNames.indexOf("k");
    const ti = fit.paramNames.indexOf("tau");
    const draws = fit.draws[ki].map((k, s) => ({ k, tau: fit.draws[ti][s] }));
    summary = summarizeDraws(draws, hyp.params);

    const pick = selectOptimalDesign(designs, draws, hyp.responseProb);
    design = pick.design;
    last_eig = pick.mutual_info;

    const ev = evaluateStopping({
      completed_trials: trials.length,
      eig: pick.mutual_info,
      max_possible_eig,
      consecutive_below,
      stopping,
    });
    consecutive_below = ev.consecutive_below;
    if (ev.should_stop) {
      stop_reason = ev.stop_reason;
      break;
    }
  }
  return { trials_run: trials.length, stop_reason, post: summary, last_eig };
}

let failures = 0;
const fail = (msg) => {
  console.log("  FAIL: " + msg);
  failures++;
};
const trueParams = { k: 0.005, tau: 3.0 }; // informative regime

console.log("\n[1] stopping ON: informative run stops before max_trials, recovery holds");
const lenient = runWithStopping(trueParams, 200, {
  min_trials: 5,
  max_trials: 36,
  eig_fraction: 0.15,
});
console.log(
  `  lenient (frac 0.15): stopped at ${lenient.trials_run}/36 trials, reason=${lenient.stop_reason}, last EIG=${(lenient.last_eig ?? NaN).toFixed(4)}, rec k=${lenient.post.post_mean.k.toExponential(2)}`,
);
if (!(lenient.trials_run < 36)) fail("expected an early stop before max_trials=36");
if (lenient.stop_reason !== "eig_fraction")
  fail(`expected stop_reason eig_fraction, got ${lenient.stop_reason}`);
if (!(lenient.trials_run >= 5)) fail("stopped before min_trials");
if (!(Math.abs(Math.log(lenient.post.post_mean.k) - Math.log(trueParams.k)) < Math.log(5)))
  fail(`k off after early stop: ${lenient.post.post_mean.k}`);

console.log("\n[2] a stricter (higher) eig_fraction stops no later than a lenient one");
const strict = runWithStopping(trueParams, 200, {
  min_trials: 5,
  max_trials: 36,
  eig_fraction: 0.35,
});
console.log(
  `  strict (frac 0.35): stopped at ${strict.trials_run}/36 trials, reason=${strict.stop_reason}`,
);
if (!(strict.trials_run <= lenient.trials_run))
  fail(
    `stricter fraction should stop no later: strict=${strict.trials_run} lenient=${lenient.trials_run}`,
  );
if (!(strict.trials_run >= 5)) fail("strict stopped before min_trials");

console.log("\n[3] min_trials is respected even with an aggressive threshold");
const guarded = runWithStopping(trueParams, 201, {
  min_trials: 12,
  max_trials: 36,
  eig_fraction: 0.9,
});
console.log(
  `  min_trials=12, frac 0.9: stopped at ${guarded.trials_run}/36 trials, reason=${guarded.stop_reason}`,
);
if (!(guarded.trials_run >= 12)) fail(`stopped before min_trials=12 (got ${guarded.trials_run})`);

console.log(
  failures === 0 ? "\nPASS: all stopping checks passed." : `\nFAIL: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
