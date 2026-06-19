// Foundational inference-correctness smoke: the JS likelihood used by the MI
// engine AND the simulator (model.responseProb / responseProbs) must match the
// COMPILED Stan likelihood, not just a hand-written formula. Each .stan exposes
// its per-trial choice probability as a transformed/generated quantity
// (hyperbolic p_ll, weber p_correct, 3IFC p_a/p_b/p_c), so for every posterior
// draw s we can compare the JS prob at that draw's parameters against Stan's own
// prob for the same draw. If these diverge, ADO would silently optimize designs
// against the wrong model and corrupt the data.
//
// Also checks fixed-seed determinism: the same data + seed yields identical draws
// (so a missing/mis-threaded seed can't silently make runs irreproducible).
//
// Real WASM via a fetch shim, bypasses the Web Worker; NOT part of `node --test`.
//
// Run: node tests/js/likelihood_parity.smoke.mjs

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
const { makeStanDataBuilder } = await import("../../jspsych-ado/ado/stan_data.js");
const hyp = (await import("../../jspsych-ado/models/hyperbolic/model.js")).default;
const weber = (await import("../../jspsych-ado/models/weber_dots/model.js")).default;
const lll = (await import("../../jspsych-ado/models/line_length_discrimination_3ifc/model.js")).default;
const exp = (await import("../../demos/byo_model_exponential/model.js")).default;

let failures = 0;
const fail = (msg) => { console.log("  FAIL: " + msg); failures++; };

async function loadModel(adapter) {
  const createModule = (await import(adapter.moduleUrl)).default;
  return StanModel.load(createModule, () => {});
}

// With N=1 there is exactly one element of each indexed Stan output, so a
// transformed/generated quantity "base" matches a single column whatever the
// index syntax (base, base.1, base[1]).
function findGenColumn(paramNames, base) {
  const matches = [];
  for (let i = 0; i < paramNames.length; i++) {
    const name = paramNames[i];
    if (name === base || name.startsWith(base + ".") || name.startsWith(base + "[")) {
      matches.push(i);
    }
  }
  if (matches.length !== 1) {
    throw new Error(`expected exactly one column for "${base}" (N=1), found ${matches.length}: [${paramNames.join(", ")}]`);
  }
  return matches[0];
}

// For each model: one fit per design (N=1), compare JS probs to Stan gen-quantity
// probs draw-for-draw. genBases is the ordered list of Stan prob columns; jsProbs
// returns the JS probabilities aligned to those columns.
const SPECS = [
  {
    name: "hyperbolic",
    adapter: hyp,
    genBases: ["p_ll"],
    jsProbs: (design, theta) => [hyp.responseProb(design, theta)],
    designs: [
      { t_ss: 0, t_ll: 30, r_ss: 40, r_ll: 80, choice: 1 },
      { t_ss: 0, t_ll: 60, r_ss: 20, r_ll: 100, choice: 0 },
      { t_ss: 5, t_ll: 90, r_ss: 50, r_ll: 60, choice: 1 },
    ],
    atol: 1e-9, // JS logistic == Stan inv_logit (same exact function)
  },
  {
    name: "weber_dots",
    adapter: weber,
    genBases: ["p_correct"],
    jsProbs: (design, theta) => [weber.responseProb(design, theta)],
    designs: [
      { n_blue: 10, n_yellow: 13, choice: 1 },
      { n_blue: 10, n_yellow: 20, choice: 1 },
      { n_blue: 16, n_yellow: 10, choice: 0 },
    ],
    // JS uses an erf approximation (Abramowitz-Stegun 7.1.26); Stan uses exact Phi.
    // This bound confirms the approximation is adequate for design selection.
    atol: 2e-6,
  },
  {
    name: "exponential",
    adapter: exp,
    genBases: ["p_ll"],
    jsProbs: (design, theta) => [exp.responseProb(design, theta)],
    designs: [
      { t_ss: 0, t_ll: 20, r_ss: 300, r_ll: 800, choice: 1 },
      { t_ss: 0, t_ll: 52, r_ss: 100, r_ll: 800, choice: 0 },
      { t_ss: 0, t_ll: 8, r_ss: 600, r_ll: 800, choice: 1 },
    ],
    atol: 1e-9, // JS logistic == Stan inv_logit (same exact function)
  },
  {
    name: "line_length_3ifc",
    adapter: lll,
    genBases: ["p_a", "p_b", "p_c"],
    jsProbs: (design, theta) => lll.responseProbs(design, theta),
    designs: [
      { standard_length: 100, delta: 8, target_index: 0, choice: 0 },
      { standard_length: 100, delta: 20, target_index: 1, choice: 1 },
      { standard_length: 100, delta: 32, target_index: 2, choice: 2 },
    ],
    atol: 1e-9, // JS softmax == Stan softmax (same exact function)
  },
];

const sample_config = { num_chains: 1, num_warmup: 100, num_samples: 100, seed: 123 };

console.log("\n[1] JS responseProb == compiled-Stan likelihood, draw-for-draw\n");
for (const spec of SPECS) {
  const stan = await loadModel(spec.adapter);
  const buildData = makeStanDataBuilder({ stanData: spec.adapter.stanData, responseSpace: spec.adapter.responseSpace });
  let maxDiff = 0;
  let comparisons = 0;

  for (const design of spec.designs) {
    const { choice, ...designOnly } = design;
    const fit = stan.sample({ data: buildData([design]), ...sample_config });
    const paramIdx = spec.adapter.params.map((p) => {
      const i = fit.paramNames.indexOf(p);
      if (i < 0) throw new Error(`${spec.name}: parameter "${p}" not in Stan output`);
      return i;
    });
    const genIdx = spec.genBases.map((base) => findGenColumn(fit.paramNames, base));
    const nDraws = fit.draws[paramIdx[0]].length;

    for (let s = 0; s < nDraws; s++) {
      const theta = {};
      spec.adapter.params.forEach((p, k) => { theta[p] = fit.draws[paramIdx[k]][s]; });
      const js = spec.jsProbs(designOnly, theta);
      for (let k = 0; k < genIdx.length; k++) {
        const stanProb = fit.draws[genIdx[k]][s];
        const diff = Math.abs(js[k] - stanProb);
        if (diff > maxDiff) maxDiff = diff;
        comparisons += 1;
      }
    }
  }

  const ok = maxDiff <= spec.atol;
  if (!ok) fail(`${spec.name}: max |JS - Stan| = ${maxDiff.toExponential(3)} exceeds atol ${spec.atol.toExponential(1)}`);
  console.log(`  ${spec.name.padEnd(18)} max |JS - Stan| = ${maxDiff.toExponential(3)}  (atol ${spec.atol.toExponential(1)}, ${comparisons} comparisons)  ${ok ? "OK" : "FAIL"}`);
}

console.log("\n[2] Fixed-seed determinism: same data + seed -> identical draws\n");
{
  const stan = await loadModel(hyp);
  const buildData = makeStanDataBuilder({ stanData: hyp.stanData, responseSpace: hyp.responseSpace });
  const data = buildData([{ t_ss: 0, t_ll: 30, r_ss: 40, r_ll: 80, choice: 1 }]);
  const cfg = { num_chains: 2, num_warmup: 150, num_samples: 150, seed: 777 };
  const a = stan.sample({ data, ...cfg });
  const b = stan.sample({ data, ...cfg });
  const ki = a.paramNames.indexOf("k");
  const ti = a.paramNames.indexOf("tau");
  let identical = a.draws[ki].length === b.draws[ki].length && a.draws[ki].length > 0;
  for (let s = 0; identical && s < a.draws[ki].length; s++) {
    if (a.draws[ki][s] !== b.draws[ki][s] || a.draws[ti][s] !== b.draws[ti][s]) identical = false;
  }
  if (!identical) fail("two fits with the same data+seed produced different draws (seed not deterministic)");
  console.log(`  hyperbolic: ${a.draws[ki].length} draws, two seeded fits ${identical ? "IDENTICAL" : "DIFFERED"}  ${identical ? "OK" : "FAIL"}`);
}

console.log(failures === 0 ? "\nPASS: likelihood parity + determinism verified." : `\nFAIL: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
