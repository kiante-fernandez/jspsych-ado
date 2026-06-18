import {
  enumerateDesigns,
  getResponseProbsFunction,
  validateResponseProbs,
} from "../ado/mi_engine.js";

// jsQuestPlus alerts on exactly-zero expected outcomes during entropy updates.
// Clip likelihoods just inside (0, 1) while leaving the model unchanged.
const QUEST_PROB_EPSILON = 1e-9;

/**
 * Return the current high-resolution time when available.
 *
 * @returns {number} Milliseconds.
 */
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Probability density for one supported JS-side prior family.
 *
 * @param {number} x - Parameter sample value.
 * @param {Object} prior - Prior spec from the model package.
 * @returns {number} Unnormalized prior density at x.
 */
function priorDensity(x, prior) {
  if (!prior || typeof prior !== "object") {
    return 0;
  }
  if (prior.dist === "lognormal") {
    if (x <= 0) {
      return 0;
    }
    const z = (Math.log(x) - prior.meanlog) / prior.sdlog;
    return Math.exp(-0.5 * z * z) / (x * prior.sdlog * Math.sqrt(2 * Math.PI));
  }
  if (prior.dist === "normal") {
    const z = (x - prior.mean) / prior.sd;
    return Math.exp(-0.5 * z * z) / (prior.sd * Math.sqrt(2 * Math.PI));
  }
  if (prior.dist === "halfnormal") {
    if (x < 0) {
      return 0;
    }
    const z = x / prior.sd;
    return Math.sqrt(2 / Math.PI) * Math.exp(-0.5 * z * z) / prior.sd;
  }
  throw new Error(`createQuestPlusController: unsupported prior dist "${prior.dist}"`);
}

/**
 * Convert model-package priors into jsQuestPlus per-parameter prior weights.
 *
 * @param {Object} model - Model adapter with params and prior.
 * @param {Object} parameter_samples - {param: [sample, ...]}.
 * @returns {Array<Array<number>>} Per-parameter normalized prior weights.
 */
function makeQuestPlusPriorWeights(model, parameter_samples) {
  return model.params.map(param => {
    const samples = parameter_samples[param];
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new Error(`createQuestPlusController: missing parameter samples for "${param}"`);
    }

    const weights = samples.map(value => priorDensity(value, model.prior[param]));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(`createQuestPlusController: prior weights for "${param}" sum to ${total}`);
    }
    return weights.map(value => value / total);
  });
}

/**
 * Keep response probabilities inside the open interval jsQuestPlus needs.
 *
 * @param {number|Array<number>} value - Raw model probability/probabilities.
 * @returns {Array<number>} Clipped categorical probabilities summing to 1.
 */
function clipResponseProbs(value) {
  const probs = validateResponseProbs(value, "createQuestPlusController");
  const clipped = probs.map(p => Math.min(1 - QUEST_PROB_EPSILON, Math.max(QUEST_PROB_EPSILON, p)));
  const total = clipped.reduce((sum, p) => sum + p, 0);
  return clipped.map(p => p / total);
}

function getResponseCount(model, responseProbs, sample_design, sample_params) {
  if (model.responseSpace && model.responseSpace.type === "binary") {
    return 2;
  }
  if (model.responseSpace && model.responseSpace.type === "categorical") {
    return model.responseSpace.n_categories;
  }
  return clipResponseProbs(responseProbs(sample_design, sample_params)).length;
}

/**
 * Create a Quest+ controller with the same start/update contract as the Stan
 * and mock controllers.
 *
 * Quest+ uses a discrete stimulus domain and a discrete parameter grid. For the
 * current jsPsych-ADO design-grid shape, the stimulus domain is the index of one
 * enumerated design; the likelihood comes from model.responseProbs, or from
 * binary model.responseProb through the standard compatibility wrapper.
 *
 * @param {Object} options
 * @param {Function} options.QuestPlus - jsQuestPlus class.
 * @param {Object} options.model - Model adapter (params, prior, responseProb/responseProbs).
 * @param {Object|Array} options.grid_design - Candidate design grid.
 * @param {Object} options.quest_plus - Quest+ settings.
 * @param {Object} options.quest_plus.parameter_samples - {param: [sample, ...]}.
 * @param {string} [options.session_id] - Session identifier saved into data.
 * @param {?number} [options.n_trials] - Total choice trials.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createQuestPlusController({
  QuestPlus,
  model,
  grid_design,
  quest_plus,
  session_id = "quest-plus-session",
  n_trials = null,
}) {
  if (typeof QuestPlus !== "function") {
    throw new Error("createQuestPlusController: QuestPlus class is required");
  }
  if (!model || !Array.isArray(model.params) ||
      (typeof model.responseProbs !== "function" && typeof model.responseProb !== "function")) {
    throw new Error("createQuestPlusController: model must define params and responseProbs or responseProb");
  }
  if (!quest_plus || !quest_plus.parameter_samples) {
    throw new Error("createQuestPlusController: quest_plus.parameter_samples is required");
  }

  const designs = enumerateDesigns(grid_design);
  if (designs.length === 0) {
    throw new Error("createQuestPlusController: grid_design produced no candidate designs");
  }
  const responseProbs = getResponseProbsFunction(model);

  const stim_samples = [designs.map((_design, index) => index)];
  const psych_samples = model.params.map(param => {
    const samples = quest_plus.parameter_samples[param];
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new Error(`createQuestPlusController: missing parameter samples for "${param}"`);
    }
    return samples;
  });
  const sample_params = {};
  model.params.forEach((param, index) => {
    sample_params[param] = psych_samples[index][0];
  });
  const response_count = getResponseCount(model, responseProbs, designs[0], sample_params);
  const prior_weights = makeQuestPlusPriorWeights(model, quest_plus.parameter_samples);

  let quest = null;
  let current_stim = null;
  let trial_index = 0;

  function getStimIndex(stim) {
    return Array.isArray(stim) ? stim[0] : stim;
  }

  function getDesign(stim) {
    const index = getStimIndex(stim);
    return designs[index];
  }

  function paramsFromValues(values) {
    const params = {};
    model.params.forEach((param, index) => {
      params[param] = values[index];
    });
    return params;
  }

  function probResponse(response_index, design_index, ...values) {
    const probs = clipResponseProbs(responseProbs(designs[design_index], paramsFromValues(values)));
    if (probs.length !== response_count) {
      throw new Error("createQuestPlusController: response probability vector length changed.");
    }
    return probs[response_index];
  }

  function makePostSummary() {
    const estimates = quest.getEstimates("mean", false);
    const sds = quest.getSDs();
    const post_mean = {};
    const post_sd = {};
    model.params.forEach((param, index) => {
      post_mean[param] = estimates[index];
      post_sd[param] = Number.isFinite(sds[index]) ? sds[index] : 0;
    });
    return { post_mean, post_sd };
  }

  function chooseDesign() {
    current_stim = quest.getStimParams();
    return getDesign(current_stim);
  }

  return {
    /**
     * Initialize Quest+ and choose the first entropy-minimizing design.
     *
     * @returns {Promise<Object>} Initial ADO state.
     */
    start: async function() {
      trial_index = 0;
      quest = new QuestPlus({
        psych_func: Array.from(
          { length: response_count },
          (_value, response_index) => (design_index, ...values) => probResponse(response_index, design_index, ...values)
        ),
        stim_samples,
        psych_samples,
        priors: QuestPlus.set_prior(prior_weights),
      });

      return {
        session_id,
        trial_index,
        next_design: chooseDesign(),
        post_mean: null,
        post_sd: null,
        api_latency_ms: null,
      };
    },

    /**
     * Update the Quest+ posterior with the latest response and select the
     * next design unless this was the final trial.
     *
     * @param {Object} trial_data - jsPsych choice row with choice.
     * @returns {Promise<Object>} Updated ADO state with posterior summaries.
     */
    update: async function(trial_data) {
      const started_at = now();
      quest.update(current_stim, trial_data.choice);
      trial_index += 1;

      const { post_mean, post_sd } = makePostSummary();
      let next_design = null;
      if (!n_trials || trial_index < n_trials) {
        next_design = chooseDesign();
      }

      return {
        session_id,
        trial_index,
        next_design,
        post_mean,
        post_sd,
        api_latency_ms: Math.round(now() - started_at),
      };
    },
  };
}

export {
  createQuestPlusController,
  clipResponseProbs,
  makeQuestPlusPriorWeights,
  priorDensity,
};
