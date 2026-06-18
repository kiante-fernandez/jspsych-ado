// Weber / approximate-number-system (ANS) model for numerosity discrimination
// (Halberda et al., 2008), as a jspsych-ado MODEL package.
//
// This is the MODEL half only — pure statistics. It is the JS adapter + the
// committed WASM for the Stan model in weber_dot_comparison.stan (from PR #39,
// @xiaohong-cai). The TASK half (canvas presentation, numerosity-pair design grid,
// the "chose the more numerous side" -> correct mapping, response labels) is part of
// the task/model split (#55) and is intentionally NOT here yet.
//
// Like every model package, this adapter is the SINGLE SOURCE OF TRUTH for the
// likelihood in JS: the ADO mutual-information engine and the simulated participant
// call choiceProbLL from here, and it must match the likelihood in
// weber_dot_comparison.stan. (NB: the contract field is named `choiceProbLL` to
// match the current engine; it will be renamed to `responseProb` with #55.)

/**
 * Standard normal CDF, Φ(x) = 0.5·(1 + erf(x/√2)).
 *
 * The Stan model uses the built-in `Phi`, but `Phi` only exists inside the compiled
 * model — the MI engine scores thousands of (design × draw) pairs per trial in JS
 * without calling Stan, and the simulator draws from this same likelihood, so we
 * need a JS Φ that matches Stan's `Phi`. erf is the Abramowitz & Stegun 7.1.26
 * rational approximation (≈1e-7 max error), which tracks `Phi` (not `Phi_approx`).
 *
 * @param {number} x - Real-valued input.
 * @returns {number} Φ(x) in [0, 1].
 */
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/**
 * The larger/smaller numerosity on a trial, independent of which colour they are.
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
 * P(correct) for one design under one parameter draw. Matches the likelihood in
 * weber_dot_comparison.stan: bernoulli(Phi((n_large - n_small) /
 * (w * sqrt(n_large^2 + n_small^2)))).
 *
 * @param {Object} design - {n_blue, n_yellow}.
 * @param {Object} params - {w} (Weber fraction; smaller = sharper acuity).
 * @returns {number} P(response = 1 = correct).
 */
function choiceProbLL(design, params) {
  const { n_large, n_small } = numerosities(design);
  const delta = n_large - n_small;
  const sigma = params.w * Math.sqrt(n_large * n_large + n_small * n_small);
  return normalCdf(delta / sigma);
}

/**
 * Optional model-specific diagnostics for the simulator (recorded as sim_<name>).
 *
 * @param {Object} design - {n_blue, n_yellow}.
 * @returns {{n_large: number, n_small: number}}
 */
function subjectiveValues(design) {
  return numerosities(design);
}

/**
 * Build the Stan `data` block from the accumulated observed trials.
 *
 * @param {Array<Object>} trials - [{n_blue, n_yellow, choice}, ...]; choice 1 = correct.
 * @returns {Object} Stan data: {N, n_blue[], n_yellow[], correct[]}.
 */
function buildData(trials) {
  return {
    N: trials.length,
    n_blue: trials.map(trial => trial.n_blue),
    n_yellow: trials.map(trial => trial.n_yellow),
    correct: trials.map(trial => trial.choice),
  };
}

const weberDotsModel = {
  id: "weber_dots",
  params: ["w"],
  // MUST match weber_dot_comparison.stan: w ~ lognormal(log(0.25), 0.5).
  prior: {
    w: { dist: "lognormal", meanlog: Math.log(0.25), sdlog: 0.5 },
  },
  posterior_display: {
    w: { label: "w", y_min: 0, y_max: 1, lower_bound: 0 },
  },
  // Absolute URL of the compiled emscripten module, resolved next to this file so a
  // Web Worker can dynamic-import() it regardless of the page's <base href>.
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData,
  choiceProbLL,
  subjectiveValues,
  // TASK-half fields (presentation / choices / response_labels / responseToOutcome)
  // are intentionally omitted here — see #42 (this issue) and #55 (task/model split).
};

export default weberDotsModel;
export { choiceProbLL, normalCdf, numerosities, buildData, subjectiveValues };
