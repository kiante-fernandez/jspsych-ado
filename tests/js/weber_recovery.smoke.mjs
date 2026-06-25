// Manual smoke test: real Stan WASM inference + ADO loop for the Weber/ANS dots
// model. Two checks:
//   1. recovery across a w sweep - recovered w within a factor of the true w
//   2. w ordering                - recovered w rises with true w
//
// Like tests/js/stan_recovery.smoke.mjs, this is not part of `node --test`: it
// loads the browser/worker WASM in Node by shimming `fetch` for file: URLs, and
// bypasses the Web Worker. It exercises weber_dot_comparison.stan, the
// weber_dots adapter (responseProb/buildData), summarizeDraws, MI design
// selection, and the model-agnostic simulator. All seeds are fixed.
//
// Run: node tests/js/weber_recovery.smoke.mjs

import "./_wasm_node_shim.mjs";

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const weber = (await import("../../src/models/weber_dots/model.js")).default;
const { enumerateDesigns, selectOptimalDesign, summarizeDraws, samplePriorDraws } =
  await import("../../src/ado/mi_engine.js");
const { createSeededRng, simulateDelayDiscountingChoice } =
  await import("../../src/ado/ado_simulation.js");

const { makeStanDataBuilder } = await import("../../src/ado/stan_data.js");
// The model declares a stanData map; generate its buildData (the framework does this
// in buildAdapter — done here directly since this smoke bypasses the facade/worker).
const buildData = makeStanDataBuilder({
  stanData: weber.stanData,
  responseSpace: weber.responseSpace,
});

const createModule = (await import(weber.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

const PAIRS = [
  { n_blue: 10, n_yellow: 11 },
  { n_blue: 10, n_yellow: 12 },
  { n_blue: 10, n_yellow: 13 },
  { n_blue: 10, n_yellow: 15 },
  { n_blue: 10, n_yellow: 20 },
  { n_blue: 10, n_yellow: 30 },
  { n_blue: 12, n_yellow: 10 },
  { n_blue: 16, n_yellow: 10 },
  { n_blue: 20, n_yellow: 10 },
];
const designs = enumerateDesigns(PAIRS);
const sample_config = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };

function runRecovery(trueW, seed, nTrials) {
  const prior_rng = createSeededRng(seed);
  const sim_rng = createSeededRng(seed + 1);
  const sim_config = { params: { w: trueW }, rt: { choice: 0 } };

  let { design } = selectOptimalDesign(
    designs,
    samplePriorDraws(weber.prior, 2000, prior_rng),
    weber.responseProb,
  );
  const trials = [];
  let summary = { post_mean: null, post_sd: null };

  for (let t = 0; t < nTrials; t++) {
    const sim = simulateDelayDiscountingChoice(design, sim_config, sim_rng, weber);
    trials.push({ ...design, choice: sim.response });

    const fit = model.sample({ data: buildData(trials), ...sample_config });
    const wi = fit.paramNames.indexOf("w");
    if (wi < 0) {
      throw new Error(
        `weber model: parameter "w" not found in Stan output (got: ${fit.paramNames.join(", ")})`,
      );
    }
    const draws = fit.draws[wi].map((w) => ({ w }));

    summary = summarizeDraws(draws, weber.params);
    ({ design } = selectOptimalDesign(designs, draws, weber.responseProb));
  }
  return summary;
}

let failures = 0;
const fail = (msg) => {
  console.log("  FAIL: " + msg);
  failures++;
};

const TRIALS = 40;
const trueWs = [0.1, 0.25, 0.5];
console.log(`\n[1] Recovery across a w sweep (${TRIALS} adaptive trials each)\n`);
console.log("true w | rec w  | within 2x?");
console.log("-------+--------+-----------");
let seed = 200;
const recs = [];
for (const w of trueWs) {
  const rec = runRecovery(w, seed, TRIALS).post_mean.w;
  seed += 10;
  const ok = Math.abs(Math.log(rec) - Math.log(w)) < Math.log(2);
  if (!ok) fail(`w off for true w=${w}: recovered ${rec}`);
  recs.push(rec);
  console.log(`${w.toFixed(2).padEnd(6)} | ${rec.toFixed(3).padEnd(6)} | ${ok ? "yes" : "NO"}`);
}

console.log("\n[2] w ordering: recovered w should rise with true w");
console.log("  true w: " + trueWs.join(" < "));
console.log("  rec  w: " + recs.map((r) => r.toFixed(3)).join("   "));
for (let i = 1; i < recs.length; i++) {
  if (!(recs[i] > recs[i - 1])) {
    fail(
      `w not increasing: true ${trueWs[i - 1]}->${trueWs[i]} gave ${recs[i - 1].toFixed(3)}->${recs[i].toFixed(3)}`,
    );
  }
}

console.log(failures === 0 ? "\nPASS: all checks passed." : `\nFAIL: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
