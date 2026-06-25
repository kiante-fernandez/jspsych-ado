// Exponential discounting model package (Samuelson, 1937).
//
// This is the "bring your own model" example (see demos/byo_model_exponential/):
// it pairs with the SAME packaged delay-discounting task as the hyperbolic model,
// and differs only in the subjective-value function — V = R * exp(-k*t) instead of
// V = R / (1 + k*t). Like every model package, this adapter is the single source of
// truth for the JS likelihood (used by the MI engine and the simulator) and must
// match exponential.stan; the prior block must match the .stan priors.
//
// Keep the compiled artifacts named main.js + main.wasm (main.js hardcodes its
// sibling main.wasm); see PROVENANCE.md to regenerate them.

/**
 * Numerically stable logistic (inverse-logit) transform.
 *
 * @param {number} value - Real-valued input.
 * @returns {number} 1 / (1 + exp(-value)) in [0, 1].
 */
function logistic(value) {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exp_value = Math.exp(value);
  return exp_value / (1 + exp_value);
}

/**
 * Exponentially discounted subjective value: V = R * exp(-k*t).
 *
 * @param {number} reward - Objective reward amount.
 * @param {number} delay - Delay until reward.
 * @param {number} k - Discount rate.
 * @returns {number} Discounted subjective value.
 */
function getExponentialValue(reward, delay, k) {
  return reward * Math.exp(-k * delay);
}

/**
 * P(choose larger-later) for one design under one parameter draw. Matches the
 * likelihood in exponential.stan: bernoulli_logit(tau * (v_ll - v_ss)).
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @param {Object} params - {k, tau}.
 * @returns {number} P(response = 1 = LL).
 */
function responseProb(design, params) {
  const v_ss = getExponentialValue(design.r_ss, design.t_ss, params.k);
  const v_ll = getExponentialValue(design.r_ll, design.t_ll, params.k);
  return logistic(params.tau * (v_ll - v_ss));
}

function responseProbs(design, params) {
  const p_ll = responseProb(design, params);
  return [1 - p_ll, p_ll];
}

/**
 * Optional model-specific diagnostics for the simulator: the exponentially
 * discounted subjective values of each option.
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @param {Object} params - {k}.
 * @returns {{v_ss: number, v_ll: number}} Subjective values.
 */
function subjectiveValues(design, params) {
  return {
    v_ss: getExponentialValue(design.r_ss, design.t_ss, params.k),
    v_ll: getExponentialValue(design.r_ll, design.t_ll, params.k),
  };
}

// Stan `data` block mirror — identical to the hyperbolic model (same task/design
// space); see ado/stan_data.js. "response" is the participant choice (binary 0/1).
const stanData = {
  t_ss: "t_ss",
  t_ll: "t_ll",
  r_ss: "r_ss",
  r_ll: "r_ll",
  y: "response",
};

const exponentialModel = {
  id: "exponential",
  params: ["k", "tau"],
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  // Must match exponential.stan: k ~ lognormal(-4, 2); tau ~ lognormal(0, 1).
  prior: {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
  },
  posterior_display: {
    k: {
      label: "k",
      y_min: 0,
      y_max: 0.2,
      lower_bound: 0,
      min_y_span: 0.05,
      histogram_scale: "log10",
      histogram_label: "log10(k)",
    },
    tau: { label: "τ", y_min: 0, y_max: 5, lower_bound: 0, min_y_span: 0.5 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  // Statically referenced so bundlers emit the .wasm asset; the worker feeds this to
  // emscripten's locateFile so the wasm loads after bundling (see ado/stan_worker.js).
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  stanData,
  responseProb,
  responseProbs,
  subjectiveValues,
};

export default exponentialModel;
export { responseProb, getExponentialValue, logistic, stanData, responseProbs, subjectiveValues };
