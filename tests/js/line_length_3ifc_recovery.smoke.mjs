// Real Stan WASM recovery smoke for the 3-parameter categorical model
// (line_length_discrimination_3ifc: sensitivity, bias_b, bias_c; 3-outcome). This
// is the >2-param case (#87): the browser smoke only asserts posteriors POPULATE,
// so this is the only check that the three parameters are RECOVERED within
// tolerance off the browser. Checks:
//   1. recovery        - all three params recovered within tolerance at N trials
//   2. sensitivity ordering - recovered sensitivity rises with the true value
//   3. precision-vs-trials  - sensitivity posterior SD shrinks with more trials
//
// Like the other recovery smokes it loads the web-only WASM in node by shimming
// `fetch` for file: URLs and bypasses the Web Worker, so it is NOT part of
// `node --test`. All seeds are fixed.
//
// Run: node tests/js/line_length_3ifc_recovery.smoke.mjs

import { readFile } from "node:fs/promises";

globalThis.window = globalThis.window || {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const s = url.toString();
  if (s.startsWith("file:")) {
    const buf = await readFile(new URL(s));
    return {
      ok: true,
      status: 200,
      url: s,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  }
  return realFetch(url, opts);
};

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const lll = (await import("../../jspsych-ado/models/line_length_discrimination_3ifc/model.js")).default;
const { enumerateDesigns, selectOptimalDesign, summarizeDraws, samplePriorDraws, getResponseProbsFunction } =
  await import("../../jspsych-ado/ado/mi_engine.js");
const { createSeededRng, simulateCategoricalChoice } = await import("../../jspsych-ado/ado/ado_simulation.js");
const { makeStanDataBuilder } = await import("../../jspsych-ado/ado/stan_data.js");

const buildData = makeStanDataBuilder({ stanData: lll.stanData, responseSpace: lll.responseSpace });
const responseProbs = getResponseProbsFunction(lll);

const createModule = (await import(lll.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

// Designs are (delta, target_index): the likelihood depends only on those (the
// standard length cancels). Vary both, across all three target positions, so the
// slope (sensitivity) and the B/C biases are identifiable.
const DELTAS = [4, 8, 16, 32];
const designs = enumerateDesigns(
  [0, 1, 2].flatMap((target_index) =>
    DELTAS.map((delta) => ({ standard_length: 100, delta, target_index }))
  )
);
const sample_config = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };

function runRecovery(trueParams, seed, nTrials) {
  const prior_rng = createSeededRng(seed);
  const sim_rng = createSeededRng(seed + 1);
  const sim_config = { params: trueParams, rt: { choice: 0 } };

  let { design } = selectOptimalDesign(designs, samplePriorDraws(lll.prior, 2000, prior_rng), responseProbs);
  const trials = [];
  let summary = { post_mean: null, post_sd: null };

  for (let t = 0; t < nTrials; t++) {
    const sim = simulateCategoricalChoice(design, sim_config, sim_rng, lll, {
      response_labels: { 0: "A", 1: "B", 2: "C" },
    });
    trials.push({ ...design, choice: sim.response });

    const fit = model.sample({ data: buildData(trials), ...sample_config });
    const idx = Object.fromEntries(lll.params.map((p) => [p, fit.paramNames.indexOf(p)]));
    for (const [p, i] of Object.entries(idx)) {
      if (i < 0) throw new Error(`line_length_3ifc: parameter "${p}" not found in Stan output`);
    }
    const n = fit.draws[idx.sensitivity].length;
    const draws = new Array(n);
    for (let s = 0; s < n; s++) {
      draws[s] = { sensitivity: fit.draws[idx.sensitivity][s], bias_b: fit.draws[idx.bias_b][s], bias_c: fit.draws[idx.bias_c][s] };
    }

    summary = summarizeDraws(draws, lll.params);
    ({ design } = selectOptimalDesign(designs, draws, responseProbs));
  }
  return summary;
}

let failures = 0;
const fail = (msg) => { console.log("  FAIL: " + msg); failures++; };

const TRIALS = 90;
console.log(`\n[1] Recovery of all 3 params (${TRIALS} adaptive trials)\n`);
const truth = { sensitivity: 2.0, bias_b: 0.6, bias_c: -0.5 };
const rec = runRecovery(truth, 300, TRIALS).post_mean;
console.log("param       | true  | rec");
console.log("------------+-------+------");
console.log(`sensitivity | ${truth.sensitivity.toFixed(2)}  | ${rec.sensitivity.toFixed(3)}`);
console.log(`bias_b      | ${truth.bias_b.toFixed(2)}  | ${rec.bias_b.toFixed(3)}`);
console.log(`bias_c      | ${truth.bias_c.toFixed(2)} | ${rec.bias_c.toFixed(3)}`);
// Tolerances are tight enough that near-prior estimates would FAIL: sensitivity
// within a factor of 1.5, biases within 0.3 of truth (prior sd on the biases is
// 0.5, so 0.3 cannot be met without genuine updating away from the prior mean 0).
if (!(Math.abs(Math.log(rec.sensitivity) - Math.log(truth.sensitivity)) < Math.log(1.5))) {
  fail(`sensitivity off: true ${truth.sensitivity}, recovered ${rec.sensitivity}`);
}
if (!(Math.abs(rec.bias_b - truth.bias_b) < 0.3)) fail(`bias_b off: true ${truth.bias_b}, recovered ${rec.bias_b}`);
if (!(Math.abs(rec.bias_c - truth.bias_c) < 0.3)) fail(`bias_c off: true ${truth.bias_c}, recovered ${rec.bias_c}`);

console.log("\n[2] Sensitivity ordering: recovered sensitivity rises with true sensitivity");
const lowS = runRecovery({ sensitivity: 1.0, bias_b: 0, bias_c: 0 }, 320, 50).post_mean.sensitivity;
const highS = runRecovery({ sensitivity: 3.0, bias_b: 0, bias_c: 0 }, 340, 50).post_mean.sensitivity;
console.log(`  true 1.0 -> rec ${lowS.toFixed(3)} ;  true 3.0 -> rec ${highS.toFixed(3)}`);
if (!(highS > lowS)) fail(`sensitivity not increasing: 1.0->${lowS.toFixed(3)}, 3.0->${highS.toFixed(3)}`);

console.log("\n[3] Precision-vs-trials: sensitivity posterior SD shrinks with more trials");
const sdFew = runRecovery(truth, 360, 5).post_sd.sensitivity;
const sdMany = runRecovery(truth, 360, 90).post_sd.sensitivity;
console.log(`  SD(sensitivity): ${sdFew.toFixed(3)} (5 trials) -> ${sdMany.toFixed(3)} (90 trials)`);
if (!(sdMany < 0.75 * sdFew)) fail(`posterior SD did not shrink enough: ${sdFew.toFixed(3)} -> ${sdMany.toFixed(3)}`);

console.log(failures === 0 ? "\nPASS: all 3IFC recovery checks passed." : `\nFAIL: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
