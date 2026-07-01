// Real Stan WASM recovery smoke for the exponential-discounting model — the
// "bring your own model" demo's model (a new .stan compiled to WASM, reusing the
// packaged delay-discounting task). Checks:
//   1. recovery        - k and tau recovered within tolerance at N adaptive trials
//   2. k ordering      - recovered k rises with the true discount rate
//   3. precision       - k posterior SD shrinks with more trials
//
// Like the other recovery smokes it loads the web-only WASM in node via a fetch
// shim and bypasses the Web Worker; NOT part of `node --test`. Seeds are fixed.
//
// Run: node tests/js/exponential_recovery.smoke.mjs

import "./_wasm_node_shim.mjs";

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const exp = (await import("../../demos/byo_model_exponential/model.js")).default;
const { design_grid } = await import("../../demos/delay_discounting/task.js");
const { enumerateDesigns, selectOptimalDesign, summarizeDraws, samplePriorDraws } =
  await import("../../src/ado/mi_engine.js");
const { createSeededRng, simulateCategoricalChoice } =
  await import("../../src/ado/ado_simulation.js");
const { makeStanDataBuilder } = await import("../../src/ado/stan_data.js");

const buildData = makeStanDataBuilder({ stanData: exp.stanData, responseSpace: exp.responseSpace });
const createModule = (await import(exp.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

// Reuse the packaged delay-discounting task's design grid (the whole point of the
// "bring your own model" demo: same task, new likelihood).
const designs = enumerateDesigns(design_grid);
const sample_config = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };

function runRecovery(trueParams, seed, nTrials) {
  const prior_rng = createSeededRng(seed);
  const sim_rng = createSeededRng(seed + 1);
  const sim_config = { params: trueParams, rt: { choice: 0 } };

  let { design } = selectOptimalDesign(
    designs,
    samplePriorDraws(exp.prior, 2000, prior_rng),
    exp.responseProb,
  );
  const trials = [];
  let summary = { post_mean: null, post_sd: null };

  for (let t = 0; t < nTrials; t++) {
    const sim = simulateCategoricalChoice(design, sim_config, sim_rng, exp);
    trials.push({ ...design, choice: sim.response });

    const fit = model.sample({ data: buildData(trials), ...sample_config });
    const ki = fit.paramNames.indexOf("k");
    const ti = fit.paramNames.indexOf("tau");
    if (ki < 0 || ti < 0) throw new Error("exponential model: k/tau not found in Stan output");
    const draws = fit.draws[ki].map((k, s) => ({ k, tau: fit.draws[ti][s] }));

    summary = summarizeDraws(draws, exp.params);
    ({ design } = selectOptimalDesign(designs, draws, exp.responseProb));
  }
  return summary;
}

let failures = 0;
const fail = (msg) => {
  console.log("  FAIL: " + msg);
  failures++;
};

const TRIALS = 42;
console.log(`\n[1] Recovery of k and tau (${TRIALS} adaptive trials)\n`);
const truth = { k: 0.05, tau: 3.0 };
const rec = runRecovery(truth, 400, TRIALS).post_mean;
console.log(`  k:   true ${truth.k}  -> rec ${rec.k.toExponential(2)}`);
console.log(`  tau: true ${truth.tau}  -> rec ${rec.tau.toFixed(2)}`);
if (!(Math.abs(Math.log(rec.k) - Math.log(truth.k)) < Math.log(3)))
  fail(`k off: true ${truth.k}, rec ${rec.k}`);
if (!(Math.abs(Math.log(rec.tau) - Math.log(truth.tau)) < Math.log(3)))
  fail(`tau off: true ${truth.tau}, rec ${rec.tau}`);

console.log("\n[2] k ordering: recovered k rises with the true discount rate");
const lowK = runRecovery({ k: 0.02, tau: 3 }, 420, 36).post_mean.k;
const highK = runRecovery({ k: 0.12, tau: 3 }, 440, 36).post_mean.k;
console.log(
  `  true 0.02 -> rec ${lowK.toExponential(2)} ;  true 0.12 -> rec ${highK.toExponential(2)}`,
);
if (!(highK > lowK))
  fail(`k not increasing: 0.02->${lowK.toExponential(2)}, 0.12->${highK.toExponential(2)}`);

console.log("\n[3] Precision-vs-trials: k posterior SD shrinks with more trials");
const sdFew = runRecovery(truth, 460, 6).post_sd.k;
const sdMany = runRecovery(truth, 460, 42).post_sd.k;
console.log(
  `  SD(k): ${sdFew.toExponential(2)} (6 trials) -> ${sdMany.toExponential(2)} (42 trials)`,
);
if (!(sdMany < sdFew))
  fail(`posterior SD did not shrink: ${sdFew.toExponential(2)} -> ${sdMany.toExponential(2)}`);

console.log(
  failures === 0
    ? "\nPASS: all exponential recovery checks passed."
    : `\nFAIL: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
