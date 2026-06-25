// Weber / approximate-number-system (ANS) model for numerosity discrimination
// (Halberda et al., 2008), packaged for jspsych-ado.
//
// This adapter is the JS mirror of weber_dot_comparison.stan. The ADO mutual-
// information engine and simulated participants call responseProb/responseProbs
// here, while TinyStan fits the compiled Stan/WASM model on data assembled from the
// stanData map below.

/**
 * Standard normal CDF, Phi(x) = 0.5 * (1 + erf(x / sqrt(2))).
 *
 * Stan uses Phi in the compiled model; the browser-side ADO engine needs the
 * same likelihood in JS when scoring candidate designs. The erf approximation is
 * Abramowitz and Stegun 7.1.26, accurate enough for design selection.
 *
 * @param {number} x
 * @returns {number}
 */
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/**
 * The larger/smaller numerosity on a trial, independent of color.
 *
 * @param {Object} design - {n_blue, n_yellow}.
 * @returns {{n_large: number, n_small: number}}
 */
function numerosities(design) {
  return {
    n_large: Math.max(design.n_blue, design.n_yellow),
    n_small: Math.min(design.n_blue, design.n_yellow),
  };
}

/**
 * P(correct) for one dot-comparison design under one Weber fraction draw.
 * Matches weber_dot_comparison.stan:
 *   correct ~ bernoulli(Phi((n_large - n_small) /
 *     (w * sqrt(n_large^2 + n_small^2)))).
 *
 * @param {Object} design - {n_blue, n_yellow}.
 * @param {Object} params - {w}.
 * @returns {number} P(outcome = 1 = correct).
 */
function responseProb(design, params) {
  const { n_large, n_small } = numerosities(design);
  const delta = n_large - n_small;
  const sigma_delta = params.w * Math.sqrt(n_large * n_large + n_small * n_small);
  return normalCdf(delta / sigma_delta);
}

function responseProbs(design, params) {
  const p_correct = responseProb(design, params);
  return [1 - p_correct, p_correct];
}

/**
 * Optional model-specific diagnostics for simulation audit fields.
 *
 * @param {Object} design - {n_blue, n_yellow}.
 * @param {Object} params - Unused; kept for the model-adapter signature.
 * @returns {{n_large: number, n_small: number}}
 */
function subjectiveValues(design, params) {
  return numerosities(design);
}

// Stan `data` block, mirroring weber_dot_comparison.stan. The framework generates
// buildData from this (see ado/stan_data.js). The Stan response var is `correct`
// (not `y`); "response" is the participant outcome (binary 0/1, so no +1).
const stanData = {
  n_blue: "n_blue",
  n_yellow: "n_yellow",
  correct: "response",
};

const weberDotsModel = {
  id: "weber_dots",
  params: ["w"],
  designKeys: ["n_blue", "n_yellow"],
  responseSpace: { type: "binary" },
  // Must match weber_dot_comparison.stan: w ~ lognormal(log(0.25), 0.5).
  prior: {
    w: { dist: "lognormal", meanlog: Math.log(0.25), sdlog: 0.5 },
  },
  posterior_display: {
    w: { label: "w", y_min: 0, y_max: 1, lower_bound: 0 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  // Statically referenced so bundlers emit the .wasm asset; the worker feeds this
  // to emscripten's locateFile so the wasm loads after bundling (see ado/stan_worker.js).
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  stanData,
  responseProb,
  responseProbs,
  subjectiveValues,
};

export default weberDotsModel;
export { stanData, normalCdf, numerosities, responseProb, responseProbs, subjectiveValues };
