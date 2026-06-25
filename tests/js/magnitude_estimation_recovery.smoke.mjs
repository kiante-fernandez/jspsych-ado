// Real Stan WASM recovery smoke for the magnitude-estimation (Stevens power law)
// model — the continuous-response DEMO model. It checks the full loop runs and recovers
// the Stevens exponent: a real Stan posterior over log_y ~ Normal(loga + b*log_s, sigma),
// with the next stimulus magnitude chosen by the continuous-MI engine over a fixed grid.
// NOTE: recovery on this broad grid is robust to WHICH magnitude is picked, so it does
// not by itself validate the density/MI math — that correctness is pinned by
// tests/js/mi_engine_continuous.test.mjs (analytic-EIG anchor + factory equality) and
// magnitude_estimation.test.mjs. Checks:
//   1. recovery   - loga, b, sigma recovered within tolerance at N adaptive trials
//   2. b ordering - recovered exponent rises with the true exponent
//   3. precision  - b posterior SD shrinks with more trials
//
// Like the other recovery smokes it loads the web-only WASM in node via a fetch shim
// and bypasses the Web Worker; NOT part of `node --test`. Seeds are fixed.
//
// Run: node tests/js/magnitude_estimation_recovery.smoke.mjs

import "./_wasm_node_shim.mjs";

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const me = (await import("../../src/models/magnitude_estimation/model.js")).default;
const { enumerateDesigns, createDesignScorer, summarizeDraws, samplePriorDraws } =
  await import("../../src/ado/mi_engine.js");
const { createSeededRng, simulateContinuousResponse } =
  await import("../../src/ado/ado_simulation.js");

const createModule = (await import(me.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

// Stimulus magnitudes (e.g. circle areas), spanning ~2 log-decades so the log-log
// slope (the Stevens exponent) is identifiable.
const designs = enumerateDesigns({ s: [10, 25, 50, 100, 250, 500, 1000] });
const scorer = createDesignScorer(me);
const sample_config = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };

function nextDesign(draws) {
  return scorer.selectOptimalDesigns(designs, draws, 1)[0].design;
}

function runRecovery(trueParams, seed, nTrials) {
  const prior_rng = createSeededRng(seed);
  const sim_rng = createSeededRng(seed + 1);
  const sim_config = { params: trueParams, rt: { choice: 0 } };

  let design = nextDesign(samplePriorDraws(me.prior, 2000, prior_rng));
  const trials = [];
  let summary = { post_mean: null, post_sd: null };

  for (let t = 0; t < nTrials; t++) {
    // The simulated participant returns log(estimate); that IS the modeled response,
    // so it goes straight into the trial as `choice` (the task's responseToOutcome
    // does the same log transform in the browser).
    const sim = simulateContinuousResponse(design, sim_config, sim_rng, me);
    trials.push({ s: design.s, choice: sim.response });

    const fit = model.sample({ data: me.buildData(trials), ...sample_config });
    const li = fit.paramNames.indexOf("loga");
    const bi = fit.paramNames.indexOf("b");
    const si = fit.paramNames.indexOf("sigma");
    if (li < 0 || bi < 0 || si < 0) {
      throw new Error("magnitude_estimation: loga/b/sigma not found in Stan output");
    }
    const draws = fit.draws[li].map((loga, i) => ({
      loga,
      b: fit.draws[bi][i],
      sigma: fit.draws[si][i],
    }));

    summary = summarizeDraws(draws, me.params);
    design = nextDesign(draws);
  }
  return summary;
}

let failures = 0;
const fail = (msg) => {
  console.log("  FAIL: " + msg);
  failures++;
};

const TRIALS = 30;
const truth = { loga: -1.5, b: 0.7, sigma: 0.25 };
console.log(`\n[1] Recovery of loga, b, sigma (${TRIALS} adaptive trials)\n`);
const rec = runRecovery(truth, 800, TRIALS).post_mean;
console.log(`  loga:  true ${truth.loga}  -> rec ${rec.loga.toFixed(3)}`);
console.log(`  b:     true ${truth.b}   -> rec ${rec.b.toFixed(3)}`);
console.log(`  sigma: true ${truth.sigma}  -> rec ${rec.sigma.toFixed(3)}`);
if (!(Math.abs(rec.b - truth.b) < 0.15)) fail(`b off: true ${truth.b}, rec ${rec.b.toFixed(3)}`);
// loga is the intercept at log_s=0 (s=1), extrapolated below the grid and correlated
// with b, so it is intentionally the loosest of the three checks (a nuisance scale).
if (!(Math.abs(rec.loga - truth.loga) < 0.5))
  fail(`loga off: true ${truth.loga}, rec ${rec.loga.toFixed(3)}`);
if (!(Math.abs(rec.sigma - truth.sigma) < 0.15))
  fail(`sigma off: true ${truth.sigma}, rec ${rec.sigma.toFixed(3)}`);

console.log("\n[2] b ordering: recovered exponent rises with the true exponent");
const bs = [0.4, 0.7, 1.2].map(
  (b, i) => runRecovery({ loga: -1.5, b, sigma: 0.25 }, 820 + i * 20, 24).post_mean.b,
);
console.log("  true: 0.4, 0.7, 1.2  -> rec: " + bs.map((x) => x.toFixed(2)).join(", "));
if (!(bs[0] < bs[1] && bs[1] < bs[2]))
  fail(`b not increasing: ${bs.map((x) => x.toFixed(2)).join(", ")}`);

console.log("\n[3] Precision-vs-trials: b posterior SD shrinks with more trials");
const sdFew = runRecovery(truth, 860, 6).post_sd.b;
const sdMany = runRecovery(truth, 860, 30).post_sd.b;
console.log(`  SD(b): ${sdFew.toFixed(4)} (6 trials) -> ${sdMany.toFixed(4)} (30 trials)`);
if (!(sdMany < sdFew))
  fail(`posterior SD did not shrink: ${sdFew.toFixed(4)} -> ${sdMany.toFixed(4)}`);

console.log(
  failures === 0
    ? "\nPASS: all magnitude-estimation recovery checks passed."
    : `\nFAIL: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
