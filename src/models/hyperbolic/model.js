// Hyperbolic discounting model package (Mazur, 1987).
//
// This adapter is the SINGLE SOURCE OF TRUTH for the model likelihood in JS. The
// simulated participant (ado/ado_simulation.js) and the ADO mutual-information
// engine (ado/mi_engine.js) both call responseProb from here, and it must match
// the likelihood in hyperbolic.stan. The prior block below must match the priors
// in hyperbolic.stan. The compiled main.js / main.wasm are produced from
// hyperbolic.stan by the stan-playground compile server (see models/README.md).
//
// Adding a new model = copy this folder, write the new <model>.stan, compile it,
// and edit params/prior/stanData/responseProb. Task presentation and design
// grids live under src/tasks/.
//
// The compiled artifacts are kept under their downloaded names (main.js + main.wasm)
// because the emscripten glue in main.js hardcodes its sibling "main.wasm"; the
// model folder namespaces them, so do not rename them.

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
 * Hyperbolically discounted subjective value: V = R / (1 + k*t).
 *
 * @param {number} reward - Objective reward amount.
 * @param {number} delay - Delay until reward.
 * @param {number} k - Discount rate.
 * @returns {number} Discounted subjective value.
 */
function getHyperbolicValue(reward, delay, k) {
  return reward / (1 + k * delay);
}

/**
 * P(choose larger-later) for one design under one parameter draw. Matches the
 * likelihood in hyperbolic.stan: bernoulli_logit(tau * (v_ll - v_ss)).
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @param {Object} params - {k, tau}.
 * @returns {number} P(response = 1 = LL).
 */
function responseProb(design, params) {
  const v_ss = getHyperbolicValue(design.r_ss, design.t_ss, params.k);
  const v_ll = getHyperbolicValue(design.r_ll, design.t_ll, params.k);
  return logistic(params.tau * (v_ll - v_ss));
}

function responseProbs(design, params) {
  const p_ll = responseProb(design, params);
  return [1 - p_ll, p_ll];
}

/**
 * Optional model-specific diagnostics for the simulator: the hyperbolically
 * discounted subjective values of each option.
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @param {Object} params - {k}.
 * @returns {{v_ss: number, v_ll: number}} Subjective values.
 */
function subjectiveValues(design, params) {
  return {
    v_ss: getHyperbolicValue(design.r_ss, design.t_ss, params.k),
    v_ll: getHyperbolicValue(design.r_ll, design.t_ll, params.k),
  };
}

// Stan `data` block, declared as a 1:1 mirror of hyperbolic.stan. The framework
// generates the buildData(trials) reshape (N + per-column maps + y) from this — see
// ado/stan_data.js. Each design column is copied; "response" is the participant's
// choice (binary 0/1 here, so no +1).
const stanData = {
  t_ss: "t_ss",
  t_ll: "t_ll",
  r_ss: "r_ss",
  r_ll: "r_ll",
  y: "response",
};

// ---------------------------------------------------------------------------
// Presentation: how a delay-discounting design is shown and answered.
//
// The generic timeline consumes this through the single-button convenience path
// (makeStimulus + button_html + keymap + prompt). The accompanying experiment
// page supplies the .dd-option-card CSS used by the markup below.
// ---------------------------------------------------------------------------

const hyperbolicModel = {
  id: "hyperbolic",
  params: ["k", "tau"],
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  prior: {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
  },
  posterior_display: {
    // y_min/y_max are preferred fallback ranges; lower_bound is the true Stan constraint.
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
  // Absolute URL of the compiled emscripten module, resolved next to this file so
  // a Web Worker can dynamic-import() it regardless of the page's <base href>.
  moduleUrl: new URL("./main.js", import.meta.url).href,
  // Statically referenced so bundlers (Vite/webpack) emit the .wasm as an asset
  // and resolve its final URL; the worker passes this to emscripten's locateFile
  // (see ado/stan_worker.js) so the wasm loads after bundling, not just from a
  // static server. Without it, a bundled main.js would 404 on its sibling wasm.
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  stanData,
  responseProb,
  responseProbs,
  subjectiveValues,
};

export default hyperbolicModel;
export { responseProb, getHyperbolicValue, logistic, stanData, responseProbs, subjectiveValues };
