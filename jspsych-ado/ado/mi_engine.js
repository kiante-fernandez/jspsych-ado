// Generic adaptive-design-optimization (ADO) math, shared by every model.
//
// This module is model-agnostic: it never references hyperbolic discounting,
// k, tau, or any particular response labels. A model supplies a response
// likelihood and the engine computes mutual information (MI) over a candidate
// design grid from posterior draws. Binary models may supply scalar
// responseProb(design, draw) = P(response=1); categorical models supply
// responseProbs(design, draw) = [p0, p1, ...].
//
// Posterior draws are passed as an array of plain objects, one per draw, keyed by
// parameter name, e.g. [{k: 0.01, tau: 1.2}, ...]. The same shape is produced for
// prior draws (first trial) and for Stan posterior draws (later trials).

const RESPONSE_PROB_SUM_TOLERANCE = 1e-6;

/**
 * Binary (Bernoulli) entropy in nats.
 *
 * @param {number} p - Probability in [0, 1].
 * @returns {number} Entropy H(p) = -(p ln p + (1-p) ln(1-p)); 0 at the endpoints.
 */
function binaryEntropy(p) {
  if (p <= 0 || p >= 1) {
    return 0;
  }
  return -(p * Math.log(p) + (1 - p) * Math.log1p(-p));
}

/**
 * Categorical entropy in nats.
 *
 * @param {Array<number>} probs - Category probabilities.
 * @returns {number} Entropy H(probs) = -sum p log(p).
 */
function categoricalEntropy(probs) {
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) {
      entropy -= p * Math.log(p);
    }
  }
  return entropy;
}

/**
 * Coerce a binary scalar or categorical vector into a response-probability vector.
 *
 * @param {number|Array<number>} value - p for binary, or [p0, p1, ...].
 * @returns {Array<number>} Response probabilities in category-index order.
 */
function asResponseProbs(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return [1 - value, value];
}

/**
 * Resolve the response-probability function from a model adapter.
 *
 * @param {Object} model - Model adapter.
 * @returns {Function} (design, draw) -> [p0, p1, ...].
 */
function getResponseProbsFunction(model) {
  if (model && typeof model.responseProbs === "function") {
    return model.responseProbs;
  }
  if (model && typeof model.responseProb === "function") {
    return (design, draw) => asResponseProbs(model.responseProb(design, draw));
  }
  throw new Error("Model must provide responseProbs(design, draw) or responseProb(design, draw).");
}

/**
 * Validate a response-probability vector.
 *
 * @param {number|Array<number>} value - Binary scalar or categorical vector.
 * @param {string} [context] - Error context.
 * @returns {Array<number>} Probabilities in response-index order.
 */
function validateResponseProbs(value, context = "response probability") {
  const probs = asResponseProbs(value);
  if (!Array.isArray(probs) || probs.length < 2) {
    throw new Error(`${context}: expected at least two response probabilities.`);
  }
  let total = 0;
  for (const p of probs) {
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) {
      throw new Error(`${context}: probabilities must be finite and nonnegative.`);
    }
    total += p;
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`${context}: probabilities must sum to a positive value.`);
  }
  if (Math.abs(total - 1) > RESPONSE_PROB_SUM_TOLERANCE) {
    throw new Error(`${context}: probabilities must sum to 1 (got ${total}).`);
  }
  return probs.slice();
}

/**
 * Expected information gain (mutual information between the response category
 * and the parameters) for one candidate design, estimated from posterior draws.
 *
 * MI(d) = H(mean_s probs_s) - mean_s H(probs_s).
 *
 * @param {Object} design - Candidate design (e.g. {t_ss, t_ll, r_ss, r_ll}).
 * @param {Array<Object>} draws - Posterior/prior draws, one object per draw.
 * @param {Function} responseFn - Model likelihood: scalar p or [p0, p1, ...].
 * @param {?Array<number>|?Float64Array} [weights] - Optional per-draw weights.
 * @returns {number} Estimated mutual information for the design (nats).
 */
function mutualInfo(design, draws, responseFn, weights = null) {
  const n = draws.length;
  let mean_probs = null;
  let cond_entropy = 0;
  let total_weight = 0;

  for (let s = 0; s < n; s++) {
    const weight = weights ? weights[s] : 1 / n;
    const probs = validateResponseProbs(responseFn(design, draws[s]), "mutualInfo");
    if (mean_probs === null) {
      mean_probs = new Array(probs.length).fill(0);
    } else if (probs.length !== mean_probs.length) {
      throw new Error("mutualInfo: response probability vectors changed length across draws.");
    }
    for (let r = 0; r < probs.length; r++) {
      mean_probs[r] += weight * probs[r];
    }
    cond_entropy += weight * categoricalEntropy(probs);
    total_weight += weight;
  }

  if (!mean_probs || total_weight <= 0) {
    return 0;
  }
  for (let r = 0; r < mean_probs.length; r++) {
    mean_probs[r] /= total_weight;
  }
  return categoricalEntropy(mean_probs) - cond_entropy / total_weight;
}

/**
 * Reweight posterior draws after a fantasized response to one design.
 *
 * This lets selectOptimalDesigns pick a small batch/testlet greedily without
 * repeating the same information target for every item in the batch. The Stan
 * posterior is still only recomputed after the real testlet responses arrive.
 *
 * @param {Object} design - Selected candidate design.
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Float64Array} weights - Per-draw weights, mutated in place.
 * @param {Function} responseFn - Model likelihood.
 * @param {Function} rng - Seeded uniform RNG in [0, 1).
 */
function applyFantasyUpdate(design, draws, weights, responseFn, rng) {
  const n = draws.length;
  const draw_probs = new Array(n);
  let mean_probs = null;

  for (let s = 0; s < n; s++) {
    const probs = validateResponseProbs(responseFn(design, draws[s]), "applyFantasyUpdate");
    if (mean_probs === null) {
      mean_probs = new Array(probs.length).fill(0);
    } else if (probs.length !== mean_probs.length) {
      throw new Error("applyFantasyUpdate: response probability vectors changed length across draws.");
    }
    draw_probs[s] = probs;
    for (let r = 0; r < probs.length; r++) {
      mean_probs[r] += weights[s] * probs[r];
    }
  }

  const draw = rng();
  let response = mean_probs.length - 1;
  let cumulative = 0;
  for (let r = 0; r < mean_probs.length; r++) {
    cumulative += mean_probs[r];
    if (draw < cumulative) {
      response = r;
      break;
    }
  }

  let total = 0;
  for (let s = 0; s < n; s++) {
    weights[s] *= draw_probs[s][response];
    total += weights[s];
  }

  if (total <= 0) {
    weights.fill(1 / n);
    return;
  }

  for (let s = 0; s < n; s++) {
    weights[s] /= total;
  }
}

/**
 * Expand a design grid into the candidate design list scored by mutual information.
 *
 * Accepts either an object of value arrays (Cartesian product, the common case)
 * or an already-curated array of design objects, which is returned as-is. The
 * array form lets a model supply hand-picked designs that are not a clean grid
 * (e.g. numerosity pairs for a dots task) without changing the engine.
 *
 * @param {Object|Array<Object>} grid_design - {t_ss:[...], ...} OR [{...}, {...}].
 * @returns {Array<Object>} Candidate designs.
 */
function enumerateDesigns(grid_design) {
  if (Array.isArray(grid_design)) {
    return grid_design;
  }
  const keys = Object.keys(grid_design);
  let combos = [{}];
  for (const key of keys) {
    const values = grid_design[key];
    const next = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({ ...combo, [key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * Pick a batch of distinct designs by sequential greedy mutual information.
 *
 * count = 1 is the original one-design ADO step. For count > 1, each selected
 * design is fantasy-updated against a frozen posterior before the next design is
 * scored, giving a testlet of non-identical designs without running Stan inside
 * the testlet.
 *
 * @param {Array<Object>} designs - Candidate designs to score.
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} responseFn - Model likelihood.
 * @param {number} [count=1] - Number of designs to return.
 * @param {Object} [options]
 * @param {Function} [options.rng] - Required when count > 1.
 * @returns {Array<{design: Object, mutual_info: number}>} Ordered design picks.
 */
function selectOptimalDesigns(designs, draws, responseFn, count = 1, options = {}) {
  const n = draws.length;
  const k = Math.min(count, designs.length);
  if (k > 1 && typeof options.rng !== "function") {
    throw new Error("selectOptimalDesigns: an rng is required when count > 1");
  }

  const weights = new Float64Array(n).fill(1 / n);
  const used = new Set();
  const picks = [];

  for (let j = 0; j < k; j++) {
    let best_index = -1;
    let best_mi = -Infinity;

    for (let i = 0; i < designs.length; i++) {
      if (used.has(i)) {
        continue;
      }
      const mi = mutualInfo(designs[i], draws, responseFn, j === 0 ? null : weights);
      if (mi > best_mi) {
        best_mi = mi;
        best_index = i;
      }
    }

    if (best_index === -1) {
      break;
    }

    used.add(best_index);
    picks.push({ design: designs[best_index], mutual_info: best_mi });

    if (j < k - 1) {
      applyFantasyUpdate(designs[best_index], draws, weights, responseFn, options.rng);
    }
  }

  return picks;
}

/**
 * Pick the design that maximizes mutual information (the ADO step). Takes an
 * already-enumerated design list so callers can enumerate the constant grid once
 * (see enumerateDesigns).
 *
 * @param {Array<Object>} designs - Candidate designs to score.
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} responseFn - Model likelihood.
 * @returns {{design: Object, mutual_info: number}} Best design and its MI.
 */
function selectOptimalDesign(designs, draws, responseFn) {
  const picks = selectOptimalDesigns(designs, draws, responseFn, 1);
  return picks[0] || { design: null, mutual_info: -Infinity };
}

/**
 * Posterior mean and SD for each parameter, from draws.
 *
 * @param {Array<Object>} draws - Draws, one object per draw.
 * @param {Array<string>} params - Parameter names to summarize (e.g. ["k", "tau"]).
 * @returns {{post_mean: Object, post_sd: Object}} Means and sample SDs keyed by param.
 */
function summarizeDraws(draws, params) {
  const n = draws.length;
  const post_mean = {};
  const post_sd = {};
  for (const param of params) {
    let sum = 0;
    for (let s = 0; s < n; s++) {
      sum += draws[s][param];
    }
    const mean = sum / n;
    let ss = 0;
    for (let s = 0; s < n; s++) {
      const d = draws[s][param] - mean;
      ss += d * d;
    }
    post_mean[param] = mean;
    post_sd[param] = Math.sqrt(ss / Math.max(1, n - 1));
  }
  return { post_mean, post_sd };
}

/**
 * Draw a standard-normal variate from a uniform RNG via Box-Muller.
 *
 * @param {Function} rng - Returns numbers in [0, 1).
 * @returns {number} A standard-normal sample.
 */
function standardNormal(rng) {
  let u1 = rng();
  const u2 = rng();
  if (u1 < 1e-12) {
    u1 = 1e-12;
  }
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Sample one parameter value from a prior specification.
 *
 * @param {Object} spec - {dist: "lognormal"|"normal"|"halfnormal", ...params}.
 * @param {Function} rng - Seeded uniform RNG.
 * @returns {number} A prior sample.
 */
function samplePriorValue(spec, rng) {
  const z = standardNormal(rng);
  switch (spec.dist) {
    case "lognormal":
      return Math.exp(spec.meanlog + spec.sdlog * z);
    case "normal":
      return spec.mean + spec.sd * z;
    case "halfnormal":
      return Math.abs(spec.sd * z);
    default:
      throw new Error(`Unknown prior dist: ${spec.dist}`);
  }
}

/**
 * Draw n samples from the model prior, used to choose the first design before any
 * data exist (the Stan model uses int<lower=1> N and cannot sample the prior).
 *
 * @param {Object} prior - {param: {dist, ...}} for each parameter.
 * @param {number} n - Number of draws.
 * @param {Function} rng - Seeded uniform RNG (reproducible).
 * @returns {Array<Object>} Prior draws in the same shape as posterior draws.
 */
function samplePriorDraws(prior, n, rng) {
  const params = Object.keys(prior);
  const draws = new Array(n);
  for (let s = 0; s < n; s++) {
    const draw = {};
    for (const param of params) {
      draw[param] = samplePriorValue(prior[param], rng);
    }
    draws[s] = draw;
  }
  return draws;
}

export {
  asResponseProbs,
  binaryEntropy,
  categoricalEntropy,
  enumerateDesigns,
  getResponseProbsFunction,
  mutualInfo,
  validateResponseProbs,
  samplePriorDraws,
  selectOptimalDesign,
  selectOptimalDesigns,
  summarizeDraws,
};
