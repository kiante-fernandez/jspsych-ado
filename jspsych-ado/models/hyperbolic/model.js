// Hyperbolic delay-discounting model package (Mazur, 1987).
//
// This adapter is the SINGLE SOURCE OF TRUTH for the model likelihood in JS. The
// simulated participant (ado/ado_simulation.js) and the ADO mutual-information
// engine (ado/mi_engine.js) both call choiceProbLL from here, and it must match
// the likelihood in hyperbolic.stan. The prior block below must match the priors
// in hyperbolic.stan. The compiled main.js / main.wasm are produced from
// hyperbolic.stan by the stan-playground compile server (see models/README.md).
//
// This package is also the SINGLE SOURCE OF TRUTH for how the task is shown: the
// `presentation` block below renders the SS/LL option cards and maps keys to the
// generic timeline (jspsych-ado/ado/ado_timeline.js), which is stimulus-agnostic.
//
// Adding a new model = copy this folder, write the new <model>.stan, compile it,
// and edit params/prior/buildData/choiceProbLL/presentation. The generic engine,
// worker, controller, and timeline never change.
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
function choiceProbLL(design, params) {
  const v_ss = getHyperbolicValue(design.r_ss, design.t_ss, params.k);
  const v_ll = getHyperbolicValue(design.r_ll, design.t_ll, params.k);
  return logistic(params.tau * (v_ll - v_ss));
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

/**
 * Build the Stan `data` block from the accumulated observed choice trials.
 *
 * @param {Array<Object>} trials - [{t_ss, t_ll, r_ss, r_ll, choice}, ...]; choice 1 = LL.
 * @returns {Object} Stan data: {N, t_ss[], t_ll[], r_ss[], r_ll[], y[]}.
 */
function buildData(trials) {
  return {
    N: trials.length,
    t_ss: trials.map(trial => trial.t_ss),
    t_ll: trials.map(trial => trial.t_ll),
    r_ss: trials.map(trial => trial.r_ss),
    r_ll: trials.map(trial => trial.r_ll),
    y: trials.map(trial => trial.choice),
  };
}

// ---------------------------------------------------------------------------
// Presentation: how a delay-discounting design is shown and answered.
//
// The generic timeline consumes this through the single-button convenience path
// (makeStimulus + button_html + keymap + prompt). The accompanying experiment
// page supplies the .dd-option-card CSS used by the markup below.
// ---------------------------------------------------------------------------

function formatDelay(delay) {
  if (delay === 0) {
    return "now";
  }
  if (delay === 1) {
    return "1 week";
  }
  return `${delay} weeks`;
}

function formatReward(reward) {
  return `$${Number(reward).toFixed(2).replace(".00", "")}`;
}

/**
 * Build the prompt HTML shown above the two option cards.
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @returns {string} HTML stimulus for jsPsychHtmlButtonResponse.
 */
function makeStimulus(design) {
  return `<p style="font-size: 1.3rem; margin: 0 0 1.75rem;">Which would you prefer?</p>`;
}

/**
 * Build the HTML for one option card (index 0 = SS, 1 = LL).
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @param {number} index - 0 for smaller-sooner, 1 for larger-later.
 * @returns {string} Button HTML for jsPsychHtmlButtonResponse.button_html.
 */
function makeOptionCardHtml(design, index) {
  const is_ss = index === 0;
  const amount = is_ss ? design.r_ss : design.r_ll;
  const delay = is_ss ? design.t_ss : design.t_ll;
  const key_hint = is_ss ? "S" : "L";
  const delay_text = delay === 0 ? "available now" : "available in " + formatDelay(delay);
  return "<button class=\"dd-option-card\">"
    + "<span class=\"dd-key-hint\">" + key_hint + "</span>"
    + "<span class=\"dd-amount\">" + formatReward(amount) + "</span>"
    + "<span class=\"dd-when\">" + delay_text + "</span>"
    + "</button>";
}

/**
 * One-line offer description for the debug log.
 *
 * @param {string} label - "SS" or "LL".
 * @param {number} reward - Reward amount.
 * @param {number} delay - Delay in weeks.
 * @returns {string} e.g. "SS: $400 now" or "LL: $800 in 52 weeks".
 */
function formatDebugOffer(label, reward, delay) {
  const delay_label = formatDelay(delay);
  const delay_text = delay_label === "now" ? delay_label : `in ${delay_label}`;
  return `${label}: ${formatReward(reward)} ${delay_text}`;
}

const presentation = {
  makeStimulus,
  button_html: (design) => [makeOptionCardHtml(design, 0), makeOptionCardHtml(design, 1)],
  // Physical key -> button index, so S/L select the SS/LL cards.
  keymap: { s: 0, l: 1 },
  prompt: "<p style=\"margin-top: 1.25rem; font-size: 0.82rem; color: #9ca3af;\">Press <strong>S</strong> for Smaller-sooner &nbsp;·&nbsp; Press <strong>L</strong> for Larger-later</p>",
  // Pretty offer lines for the debug console (falls back to key=value otherwise).
  describeDesign: (design) => [
    formatDebugOffer("SS", design.r_ss, design.t_ss),
    formatDebugOffer("LL", design.r_ll, design.t_ll),
  ],
};

const hyperbolicModel = {
  id: "hyperbolic",
  params: ["k", "tau"],
  prior: {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
  },
  posterior_display: {
    k: { label: "k", y_min: 0, y_max: 700, lower_bound: 0 },
    tau: { label: "τ", y_min: 0, y_max: 7, lower_bound: 0 },
  },
  // Absolute URL of the compiled emscripten module, resolved next to this file so
  // a Web Worker can dynamic-import() it regardless of the page's <base href>.
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData,
  choiceProbLL,
  subjectiveValues,
  // Stimulus + response contract consumed by the generic timeline.
  presentation,
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" },
};

export default hyperbolicModel;
export {
  choiceProbLL,
  getHyperbolicValue,
  logistic,
  buildData,
  subjectiveValues,
  presentation,
};
