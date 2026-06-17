// This file defines the simulated participant used by jsPsych.simulate().
// It does not choose adaptive designs or update the posterior; ADOpy does that
// in API mode. The model below only decides which button a simulated participant
// clicks for the current SS/LL design.

/**
 * @typedef {Object} DelayDiscountingDesign
 * @property {number} r_ss - Smaller-sooner reward.
 * @property {number} t_ss - Smaller-sooner delay.
 * @property {number} r_ll - Larger-later reward.
 * @property {number} t_ll - Larger-later delay.
 */

/**
 * @typedef {Object} DelayDiscountingSimulationParams
 * @property {number} k - Discount rate; larger values discount delayed rewards more.
 * @property {number} tau - Choice sensitivity; larger values make choices less noisy.
 */

/**
 * @typedef {Object} DelayDiscountingProbability
 * @property {number} p_ll - Probability of choosing the larger-later option.
 * @property {number} v_ss - Subjective value of the smaller-sooner option.
 * @property {number} v_ll - Subjective value of the larger-later option.
 */

/**
 * @typedef {Object} DelayDiscountingSimulatedChoiceData
 * @property {number} response - jsPsych button index to simulate, 0 = SS and 1 = LL.
 * @property {number} rt - Simulated response time.
 * @property {number} sim_p_ll - Probability of LL under the simulated participant.
 * @property {number} sim_k - Data-generating discount-rate parameter.
 * @property {number} sim_tau - Data-generating choice-sensitivity parameter.
 * @property {number} sim_v_ss - Simulated subjective value of the SS option.
 * @property {number} sim_v_ll - Simulated subjective value of the LL option.
 * @property {number} sim_draw - Seeded random draw used to sample response from sim_p_ll.
 */

const SS_RESPONSE = 0;
const LL_RESPONSE = 1;

/**
 * Create a deterministic random number generator for reproducible simulations.
 *
 * @param {number} seed - Integer seed for the generator.
 * @returns {Function} Function that returns numbers in [0, 1).
 */
function createSeededRng(seed) {
  let state = Math.floor(Number(seed)) % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }

  return function() {
    state = state * 16807 % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * Transform any real value to the [0, 1] probability scale.
 *
 * @param {number} value - Real-valued input.
 * @returns {number} Logistic transform of value.
 */
function logistic(value) {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }

  const exp_value = Math.exp(value);
  return exp_value / (1 + exp_value);
}

/**
 * Compute hyperbolically discounted subjective value.
 *
 * @param {number} reward - Objective reward amount.
 * @param {number} delay - Delay until reward.
 * @param {number} k - Discount rate.
 * @returns {number} Subjective value after temporal discounting.
 */
function getHyperbolicValue(reward, delay, k) {
  return reward / (1 + k * delay);
}

/**
 * Compute ADOpy ModelHyp-style choice probability for one SS/LL design.
 *
 * @param {DelayDiscountingDesign} design - Current delay-discounting design.
 * @param {DelayDiscountingSimulationParams} params - Simulated participant parameters.
 * @returns {DelayDiscountingProbability} Subjective values and P(LL).
 */
function getDelayDiscountingProbability(design, params) {
  const k = Number(params.k);
  const tau = Number(params.tau);

  const v_ss = getHyperbolicValue(design.r_ss, design.t_ss, k);
  const v_ll = getHyperbolicValue(design.r_ll, design.t_ll, k);

  // ADOpy ModelHyp-style choice rule: larger value differences make LL more
  // likely; tau controls how deterministic the choice is.
  const p_ll = logistic(tau * (v_ll - v_ss));

  return {
    p_ll,
    v_ss,
    v_ll,
  };
}

/**
 * Generate jsPsych simulation data for one delay-discounting choice trial.
 *
 * @param {DelayDiscountingDesign} design - Current SS/LL design shown on screen.
 * @param {Object} simulation_config - Delay-discounting simulation settings.
 * @param {DelayDiscountingSimulationParams} simulation_config.params - Simulated participant parameters.
 * @param {Object} simulation_config.rt - Simulated response times.
 * @param {number} simulation_config.rt.choice - Simulated choice-trial RT.
 * @param {Function} rng - Seeded random number generator.
 * @returns {DelayDiscountingSimulatedChoiceData} jsPsych response/RT plus sim_* audit fields.
 */
function simulateDelayDiscountingChoice(design, simulation_config, rng) {
  const params = simulation_config.params;
  const probability = getDelayDiscountingProbability(design, params);
  const draw = rng();
  const response = draw < probability.p_ll ? LL_RESPONSE : SS_RESPONSE;

  return {
    // jsPsych simulation fields. response is the button index to click.
    response,
    rt: simulation_config.rt.choice,

    // Audit fields saved into the jsPsych data row for validation/recovery.
    sim_p_ll: probability.p_ll,
    sim_k: Number(params.k),
    sim_tau: Number(params.tau),
    sim_v_ss: probability.v_ss,
    sim_v_ll: probability.v_ll,
    sim_draw: draw,
  };
}

export {
  createSeededRng,
  getDelayDiscountingProbability,
  getHyperbolicValue,
  LL_RESPONSE,
  logistic,
  SS_RESPONSE,
  simulateDelayDiscountingChoice,
};
