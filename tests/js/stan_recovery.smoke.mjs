// Manual smoke test: real Stan WASM inference + ADO loop, parameter recovery.
//
// This is NOT part of `node --test` because it loads the BROWSER wasm module
// (compiled with -sENVIRONMENT=web) in node by shimming `fetch` for file: URLs.
// It exercises the full pipeline that the browser uses minus the Web Worker:
// the hyperbolic.stan model, buildData, paramName extraction, summarizeDraws, and
// MI design selection, recovering a known simulated participant.
//
// Run:  node tests/js/stan_recovery.smoke.mjs
//
// Expect: post-mean k converges toward the data-generating sim_k (0.001). tau is
// only weakly identifiable from a few dozen binary choices, so it converges more
// slowly; that is expected, not a bug.

import { readFile } from "node:fs/promises";

// Make the web-only emscripten module loadable in node: pretend we are in a web
// environment and teach fetch to read the sibling .wasm from disk.
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
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  }
  return realFetch(url, opts);
};

const StanModel = (await import("../../core/tinystan/index.mjs")).default;
const hyp = (await import("../../experiments/delay_discounting/models/hyperbolic/model.js")).default;
const { enumerateDesigns, selectOptimalDesign, summarizeDraws, samplePriorDraws } = await import(
  "../../experiments/delay_discounting/ado/mi_engine.js"
);
const { createSeededRng, simulateDelayDiscountingChoice } = await import(
  "../../experiments/delay_discounting/dd_simulation.js"
);
const { default_dd_config, default_dd_simulation_config } = await import(
  "../../experiments/delay_discounting/dd_config.js"
);

const createModule = (await import(hyp.moduleUrl)).default;
const model = await StanModel.load(createModule, () => {});
console.log("stan version:", model.stanVersion());

const designs = enumerateDesigns(default_dd_config.grid_design);
const sample_config = { ...default_dd_config.stan };
const true_params = default_dd_simulation_config.params;

const prior_rng = createSeededRng(sample_config.seed);
const sim_rng = createSeededRng(default_dd_simulation_config.seed);

// First design from prior draws (mirrors controller.start()).
let { design } = selectOptimalDesign(
  designs,
  samplePriorDraws(hyp.prior, 2000, prior_rng),
  hyp.choiceProbLL,
);

const trials = [];
let post_mean = null;
for (let t = 0; t < default_dd_config.n_trials; t++) {
  const sim = simulateDelayDiscountingChoice(design, default_dd_simulation_config, sim_rng, hyp);
  trials.push({ ...design, choice: sim.response });

  const fit = model.sample({ data: hyp.buildData(trials), ...sample_config });
  const ki = fit.paramNames.indexOf("k");
  const ti = fit.paramNames.indexOf("tau");
  const draws = fit.draws[ki].map((k, s) => ({ k, tau: fit.draws[ti][s] }));

  ({ post_mean } = summarizeDraws(draws, hyp.params));
  ({ design } = selectOptimalDesign(designs, draws, hyp.choiceProbLL));

  if ((t + 1) % 7 === 0 || t === 0) {
    console.log(
      `trial ${t + 1}: post k=${post_mean.k.toExponential(2)} tau=${post_mean.tau.toFixed(2)}`,
    );
  }
}

console.log(`\nTRUE  k=${true_params.k}  tau=${true_params.tau}`);
console.log(`FINAL k=${post_mean.k.toExponential(3)}  tau=${post_mean.tau.toFixed(3)}`);

const k_ok = Math.abs(Math.log(post_mean.k) - Math.log(true_params.k)) < Math.log(3);
console.log(k_ok ? "\nPASS: k recovered within a factor of 3" : "\nWARN: k recovery off");
process.exit(k_ok ? 0 : 1);
