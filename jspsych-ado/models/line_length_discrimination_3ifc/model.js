const LINE_LENGTH_SCALE = 20;
const LINE_KEYS = ["line_length_a", "line_length_b", "line_length_c"];

function softmax(values) {
  const max_value = Math.max(...values);
  const exp_values = values.map(value => Math.exp(value - max_value));
  const total = exp_values.reduce((sum, value) => sum + value, 0);
  return exp_values.map(value => value / total);
}

function getLineLength(design, index) {
  const key = LINE_KEYS[index];
  if (typeof design[key] === "number") {
    return design[key];
  }
  return design.standard_length + (Number(design.target_index) === index ? design.delta : 0);
}

/**
 * Convert a 3IFC line-length design into softmax evidence for A/B/C responses.
 *
 * @param {Object} design - {standard_length, delta, target_index, line_length_a/b/c}.
 * @param {Object} params - {sensitivity, bias_b, bias_c}.
 * @returns {number[]} Evidence values; larger values favor choosing that position.
 */
function lineLengthEvidence(design, params) {
  const biases = [0, params.bias_b || 0, params.bias_c || 0];
  let evidence = [];
  for (let i = 0; i < LINE_KEYS.length; i++) {
    const length_difference = getLineLength(design, i) - design.standard_length;
    evidence.push(biases[i] + params.sensitivity * (length_difference / LINE_LENGTH_SCALE));
  }
  return evidence;
}

/**
 * Multinomial-logit response probabilities for one 3IFC line-length design.
 *
 * @param {Object} design - A 3IFC design object.
 * @param {Object} params - {sensitivity, bias_b, bias_c}.
 * @returns {number[]} [P(A), P(B), P(C)].
 */
function responseProbs(design, params) {
  return softmax(lineLengthEvidence(design, params));
}

/**
 * Model-specific simulation audit fields saved alongside generic sim_* fields.
 *
 * @param {Object} design - A 3IFC design object.
 * @param {Object} params - Data-generating parameters.
 * @param {number[]} probs - [P(A), P(B), P(C)].
 * @param {number} response - Simulated response index.
 * @returns {Object} Additional sim_* fields.
 */
function simulationData(design, params, probs, response) {
  return {
    sim_p_a: probs[0],
    sim_p_b: probs[1],
    sim_p_c: probs[2],
    sim_correct_response: design.target_index,
    sim_correct: response === design.target_index,
  };
}

/**
 * Build the Stan data shape for the 3IFC categorical ADO model.
 *
 * Stan categorical responses and target positions are 1-indexed, so jsPsych
 * choices/target indices 0/1/2 become 1/2/3 here.
 *
 * @param {Array<Object>} trials - Rows with {delta, target_index, choice}.
 * @returns {Object} Stan data: {N, delta[], target_index[], y[]}.
 */
function buildData(trials) {
  return {
    N: trials.length,
    delta: trials.map(trial => trial.delta),
    target_index: trials.map(trial => Number(trial.target_index) + 1),
    y: trials.map(trial => Number(trial.choice) + 1),
  };
}

const lineLengthDiscriminationModel = {
  id: "line_length_discrimination_3ifc",
  params: ["sensitivity", "bias_b", "bias_c"],
  designKeys: [
    "standard_length",
    "delta",
    "target_index",
    "line_length_a",
    "line_length_b",
    "line_length_c",
  ],
  responseSpace: { type: "categorical", n_categories: 3 },
  prior: {
    sensitivity: { dist: "lognormal", meanlog: 0, sdlog: 0.5 },
    bias_b: { dist: "normal", mean: 0, sd: 0.5 },
    bias_c: { dist: "normal", mean: 0, sd: 0.5 },
  },
  posterior_display: {
    sensitivity: { label: "sensitivity", y_min: 0, y_max: 5, lower_bound: 0 },
    bias_b: { label: "B bias", y_min: -1.5, y_max: 1.5 },
    bias_c: { label: "C bias", y_min: -1.5, y_max: 1.5 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData,
  responseProbs,
  simulationData,
};

export default lineLengthDiscriminationModel;
export {
  LINE_LENGTH_SCALE,
  LINE_KEYS,
  buildData,
  getLineLength,
  lineLengthDiscriminationModel,
  lineLengthEvidence,
  responseProbs,
  simulationData,
  softmax,
};
