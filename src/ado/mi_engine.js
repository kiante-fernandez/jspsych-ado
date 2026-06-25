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
  // Binary responses are the common case; route them through binaryEntropy so the
  // engine and that exported helper share one definition (and gain its log1p
  // precision near the endpoints). The general loop handles 3+ categories.
  if (probs.length === 2) {
    return binaryEntropy(probs[1]);
  }
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) {
      entropy -= p * Math.log(p);
    }
  }
  return entropy;
}

/**
 * Differential entropy of a Gaussian, in nats: 0.5 * ln(2*pi*e*sigma^2). The
 * continuous analogue of binaryEntropy/categoricalEntropy; used as the closed-form
 * conditional entropy of a Gaussian-response model.
 *
 * @param {number} sd - Standard deviation (> 0).
 * @returns {number} Differential entropy in nats.
 */
function gaussianEntropy(sd) {
  return 0.5 * Math.log(2 * Math.PI * Math.E * sd * sd);
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
 * Resolve the response-density function from a continuous model adapter.
 *
 * @param {Object} model - Model adapter.
 * @returns {Function} (design, draw, y) -> p(y | theta, d) >= 0.
 */
function getResponseDensityFunction(model) {
  if (model && typeof model.responseDensity === "function") {
    return model.responseDensity;
  }
  throw new Error("Continuous model must provide responseDensity(design, draw, y).");
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
  return Math.max(0, categoricalEntropy(mean_probs) - cond_entropy / total_weight);
}

/**
 * Composite Simpson coefficient for node i over an even number of intervals n:
 * 1 at the two endpoints, 4 at odd interior nodes, 2 at even interior nodes.
 *
 * @param {number} i - Node index in [0, n].
 * @param {number} n - Even interval count.
 * @returns {number} The Simpson weight coefficient (1, 2, or 4).
 */
function simpsonCoefficient(i, n) {
  if (i === 0 || i === n) {
    return 1;
  }
  return i % 2 === 1 ? 4 : 2;
}

/** x ln x with the entropy convention 0 ln 0 = 0. */
function xLogX(value) {
  return value > 0 ? value * Math.log(value) : 0;
}

/**
 * Resolve and validate the integration support [lo, hi] for a continuous design.
 *
 * @param {Array<number>|Function} support - [lo, hi] or (design, draws) -> [lo, hi].
 * @param {Object} design - Candidate design.
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @returns {Array<number>} A finite [lo, hi] with lo < hi.
 */
function resolveContinuousSupport(support, design, draws) {
  const resolved = typeof support === "function" ? support(design, draws) : support;
  if (
    !Array.isArray(resolved) ||
    resolved.length !== 2 ||
    !Number.isFinite(resolved[0]) ||
    !Number.isFinite(resolved[1]) ||
    !(resolved[0] < resolved[1])
  ) {
    throw new Error(
      "mutualInfoContinuous: needs a finite integration support [lo, hi] with lo < hi " +
        "(pass options.support as [lo, hi] or a (design, draws) => [lo, hi] function).",
    );
  }
  return resolved;
}

/**
 * Expected information gain for a CONTINUOUS response, estimated by 1-D numerical
 * integration (composite Simpson) of the predictive density over a response mesh.
 *
 * Unlike the discrete path (mutualInfo), the response is not enumerable, so the
 * model supplies a DENSITY p(y | design, draw) >= 0 rather than a probability
 * vector. EIG(d) = H(Y | d) - E_theta[ H(Y | theta, d) ], with:
 *   - H(Y | d): entropy of the predictive mixture pbar(y) = mean_s p(y | theta_s, d),
 *     computed by quadrature over the mesh.
 *   - E_theta[H(Y | theta, d)]: the per-draw conditional entropy averaged over draws.
 *     Supply options.conditionalEntropy(design, draw) when it is closed-form (strongly
 *     preferred, e.g. a Gaussian response: 0.5*ln(2*pi*e*sigma^2)); otherwise it is
 *     estimated by quadrature on the same mesh, which assumes the mesh also resolves
 *     each conditional density.
 *
 * The mesh is an integration detail only: the model and the saved data stay
 * continuous, and EIG is returned in nats, directly comparable across designs.
 *
 * @param {Object} design - Candidate design.
 * @param {Array<Object>} draws - Posterior/prior draws, one object per draw.
 * @param {Function} densityFn - (design, draw, y) -> p(y | theta, d) >= 0.
 * @param {Object} [options]
 * @param {Array<number>|Function} options.support - [lo, hi] or (design, draws) -> [lo, hi].
 * @param {number} [options.intervals=256] - Even Simpson interval count (mesh resolution).
 * @param {Function} [options.conditionalEntropy] - (design, draw) -> H(Y | theta, d), closed-form.
 * @param {Function} [options.densityFactory] - (design, draw) -> ((y) -> density): an optional
 *   fast path that hoists per-(design, draw) constants (mean, normalizer) out of the node
 *   loop. Must compute the same density as densityFn; falls back to densityFn when omitted.
 * @returns {number} Estimated mutual information for the design (nats).
 */
function mutualInfoContinuous(design, draws, densityFn, options = {}) {
  const n = draws.length;
  if (n === 0) {
    return 0;
  }
  const [lo, hi] = resolveContinuousSupport(options.support, design, draws);
  let intervals =
    Number.isInteger(options.intervals) && options.intervals > 0 ? options.intervals : 256;
  if (intervals % 2 === 1) {
    intervals += 1; // Simpson needs an even interval count.
  }
  const step = (hi - lo) / intervals;
  const conditionalEntropyFn =
    typeof options.conditionalEntropy === "function" ? options.conditionalEntropy : null;

  // Optional per-(design, draw) precompute: when the model supplies a densityFactory,
  // build one y-evaluator per draw ONCE (hoisting the mean/normalizer), then call it at
  // every node. Without a factory, call densityFn(design, draw, y) directly as before.
  const factory = typeof options.densityFactory === "function" ? options.densityFactory : null;
  let drawFns = null;
  if (factory) {
    drawFns = new Array(n);
    for (let s = 0; s < n; s++) {
      drawFns[s] = factory(design, draws[s]);
    }
  }

  let marginal_accum = 0;
  // Only needed for the quadrature fallback when no closed-form conditional entropy is given.
  const conditional_accum = conditionalEntropyFn ? null : new Float64Array(n);

  for (let i = 0; i <= intervals; i++) {
    const y = i === intervals ? hi : lo + i * step;
    const coef = simpsonCoefficient(i, intervals);
    let pbar = 0;
    for (let s = 0; s < n; s++) {
      const p = drawFns ? drawFns[s](y) : densityFn(design, draws[s], y);
      if (!Number.isFinite(p) || p < 0) {
        throw new Error("mutualInfoContinuous: density must be finite and nonnegative.");
      }
      pbar += p;
      if (conditional_accum) {
        conditional_accum[s] += coef * xLogX(p);
      }
    }
    marginal_accum += coef * xLogX(pbar / n);
  }

  const scale = step / 3;
  const marginal_entropy = -scale * marginal_accum;

  let conditional_entropy = 0;
  if (conditionalEntropyFn) {
    for (let s = 0; s < n; s++) {
      conditional_entropy += conditionalEntropyFn(design, draws[s]);
    }
    conditional_entropy /= n;
  } else {
    for (let s = 0; s < n; s++) {
      conditional_entropy += -scale * conditional_accum[s];
    }
    conditional_entropy /= n;
  }

  return Math.max(0, marginal_entropy - conditional_entropy);
}

/**
 * KL(p(theta | y, d) || p(theta)) from per-draw likelihoods of the observed
 * response, via importance weighting. Shared by the discrete and continuous
 * realized-gain estimators: the only difference is whether the per-draw likelihood
 * is a probability (discrete) or a density (continuous); the normalization cancels
 * in the ratio either way.
 *
 * @param {Array<number>} likelihoods - Per-draw likelihood of the observed response.
 * @returns {number} Realized information gain in nats.
 */
function realizedGainFromLikelihoods(likelihoods) {
  if (likelihoods.length === 0) {
    return 0;
  }
  const total_likelihood = likelihoods.reduce((sum, likelihood) => sum + likelihood, 0);
  if (total_likelihood <= 0) {
    return 0;
  }
  const predictive_likelihood = total_likelihood / likelihoods.length;
  let gain = 0;
  for (const likelihood of likelihoods) {
    if (likelihood <= 0) {
      continue;
    }
    const posterior_weight = likelihood / total_likelihood;
    gain += posterior_weight * Math.log(likelihood / predictive_likelihood);
  }
  return Math.max(0, gain);
}

/**
 * Realized information gain after observing one response to a design.
 *
 * This is KL(p(theta | y, d) || p(theta)) estimated from the pre-trial
 * posterior/prior draws via likelihood weighting. Its expectation over possible
 * responses equals the mutual information for the design.
 *
 * @param {Object} design - Presented design.
 * @param {Array<Object>} draws - Pre-response posterior/prior draws.
 * @param {number} response - Observed outcome index.
 * @param {Function} responseFn - Model likelihood: scalar p or [p0, p1, ...].
 * @returns {number} Realized information gain in nats.
 */
function realizedInformationGain(design, draws, response, responseFn) {
  const response_index = Number(response);
  if (!Number.isInteger(response_index) || response_index < 0) {
    throw new Error(
      `realizedInformationGain: response must be a nonnegative integer index (got ${response}).`,
    );
  }

  const likelihoods = [];
  for (const draw of draws) {
    const probs = validateResponseProbs(responseFn(design, draw), "realizedInformationGain");
    if (response_index >= probs.length) {
      throw new Error(
        `realizedInformationGain: response index ${response_index} is outside ` +
          `the response probability vector length ${probs.length}.`,
      );
    }
    const likelihood = probs[response_index];
    if (Number.isFinite(likelihood) && likelihood >= 0) {
      likelihoods.push(likelihood);
    }
  }
  return realizedGainFromLikelihoods(likelihoods);
}

/**
 * Realized information gain for a CONTINUOUS response. Identical importance-weighted
 * KL estimate as realizedInformationGain, but the per-draw likelihood is the response
 * DENSITY evaluated at the observed real-valued y (rather than a probability indexed
 * by an outcome). The density normalization cancels in the KL ratio.
 *
 * @param {Object} design - Presented design.
 * @param {Array<Object>} draws - Pre-response posterior/prior draws.
 * @param {number} response - Observed real-valued response y.
 * @param {Function} densityFn - (design, draw, y) -> p(y | theta, d) >= 0.
 * @returns {number} Realized information gain in nats.
 */
function realizedInformationGainContinuous(design, draws, response, densityFn) {
  const y = Number(response);
  if (!Number.isFinite(y)) {
    throw new Error(
      `realizedInformationGainContinuous: response must be a finite number (got ${response}).`,
    );
  }
  const likelihoods = [];
  for (const draw of draws) {
    const density = densityFn(design, draw, y);
    if (Number.isFinite(density) && density >= 0) {
      likelihoods.push(density);
    }
  }
  return realizedGainFromLikelihoods(likelihoods);
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
      throw new Error(
        "applyFantasyUpdate: response probability vectors changed length across draws.",
      );
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

// Default half-width (in conditional SDs) for auto-deriving the integration support
// from a continuous model's per-draw response moments. 8 SDs around the extreme
// component means covers the predictive mixture's mass to ~1e-15 in the tails.
const DEFAULT_SUPPORT_SD_MULTIPLE = 8;

/**
 * Build a (design, draws) -> [lo, hi] integration-support resolver for a continuous
 * model. Priority: an explicit responseSupport ([lo, hi] or a function), else
 * auto-derived from responseMoments(design, draw) -> { mean, sd } as
 * [min(mean - k*sd), max(mean + k*sd)] over the draws. Throws if the model supplies
 * neither, so a continuous model fails fast at setup rather than deep in the engine.
 *
 * @param {Object} model - Continuous model adapter.
 * @param {number} [sdMultiple=8] - Half-width in conditional SDs for the moment path.
 * @returns {Function} (design, draws) -> [lo, hi].
 */
function makeContinuousSupportResolver(model, sdMultiple = DEFAULT_SUPPORT_SD_MULTIPLE) {
  if (Array.isArray(model.responseSupport)) {
    const fixed = model.responseSupport;
    return () => fixed;
  }
  if (typeof model.responseSupport === "function") {
    return model.responseSupport;
  }
  if (typeof model.responseMoments === "function") {
    return (design, draws) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const draw of draws) {
        const moments = model.responseMoments(design, draw);
        const mean = Number(moments && moments.mean);
        const sd = Number(moments && moments.sd);
        if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) {
          throw new Error(
            "responseMoments(design, draw) must return finite { mean, sd } with sd > 0.",
          );
        }
        const half = sdMultiple * sd;
        if (mean - half < lo) {
          lo = mean - half;
        }
        if (mean + half > hi) {
          hi = mean + half;
        }
      }
      return [lo, hi];
    };
  }
  throw new Error(
    "Continuous model needs responseSupport ([lo, hi] or a (design, draws) => [lo, hi] function) " +
      "or responseMoments(design, draw) => { mean, sd } for automatic support.",
  );
}

/**
 * Pick the MI-optimal design for a CONTINUOUS response (the continuous analogue of
 * selectOptimalDesigns). Returns the same {design, mutual_info} pick shape so the
 * controller is agnostic to response type.
 *
 * Testlet batching (count > 1) is not yet supported for continuous responses: the
 * fantasy update needs a continuous response sampler, which is a follow-up.
 *
 * @param {Array<Object>} designs - Candidate designs to score.
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} scoreDesign - (design, draws) => mutual information for the design.
 * @param {number} [count=1] - Number of designs to return (only 1 supported).
 * @returns {Array<{design: Object, mutual_info: number}>} The single best pick (or []).
 */
function selectOptimalDesignsContinuous(designs, draws, scoreDesign, count = 1) {
  const k = Math.min(count, designs.length);
  if (k > 1) {
    throw new Error(
      "selectOptimalDesignsContinuous: testlet batching (count > 1) is not yet supported for continuous responses.",
    );
  }
  if (k <= 0) {
    return [];
  }
  let best_design = null;
  let best_mi = -Infinity;
  for (const design of designs) {
    const mi = scoreDesign(design, draws);
    if (mi > best_mi) {
      best_mi = mi;
      best_design = design;
    }
  }
  return best_design === null ? [] : [{ design: best_design, mutual_info: best_mi }];
}

/**
 * Build a response-type-agnostic design scorer for a model adapter. Dispatches once,
 * at setup, on responseSpace.type so the controller resolves a single scorer and
 * never branches on response type. Both branches expose the same three methods.
 *
 * @param {Object} model - Model adapter (discrete: responseProb/responseProbs;
 *   continuous: responseDensity plus responseMoments or responseSupport).
 * @returns {{mutualInfo: Function, selectOptimalDesigns: Function, realizedInformationGain: Function}}
 */
function createDesignScorer(model) {
  const type = model && model.responseSpace && model.responseSpace.type;
  if (type === "continuous") {
    const densityFn = getResponseDensityFunction(model);
    const conditionalEntropy =
      typeof model.conditionalEntropy === "function" ? model.conditionalEntropy : undefined;
    const densityFactory =
      typeof model.responseDensityFactory === "function" ? model.responseDensityFactory : undefined;
    const supportFn = makeContinuousSupportResolver(model);
    const intervals = model.responseSpace.intervals;
    // Single owner of the per-design MI options, reused by the mutualInfo method and
    // the selection loop so the support/conditionalEntropy/intervals wiring lives once.
    const scoreDesign = (design, draws) =>
      mutualInfoContinuous(design, draws, densityFn, {
        support: supportFn(design, draws),
        conditionalEntropy,
        densityFactory,
        intervals,
      });
    return {
      mutualInfo: scoreDesign,
      selectOptimalDesigns: (designs, draws, count = 1) =>
        selectOptimalDesignsContinuous(designs, draws, scoreDesign, count),
      realizedInformationGain: (design, draws, response) =>
        realizedInformationGainContinuous(design, draws, response, densityFn),
    };
  }
  const responseFn = getResponseProbsFunction(model);
  return {
    mutualInfo: (design, draws) => mutualInfo(design, draws, responseFn),
    selectOptimalDesigns: (designs, draws, count = 1, options = {}) =>
      selectOptimalDesigns(designs, draws, responseFn, count, options),
    realizedInformationGain: (design, draws, response) =>
      realizedInformationGain(design, draws, response, responseFn),
  };
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
  createDesignScorer,
  enumerateDesigns,
  gaussianEntropy,
  getResponseProbsFunction,
  makeContinuousSupportResolver,
  mutualInfo,
  mutualInfoContinuous,
  realizedInformationGain,
  realizedInformationGainContinuous,
  validateResponseProbs,
  samplePriorDraws,
  selectOptimalDesign,
  selectOptimalDesigns,
  standardNormal,
  summarizeDraws,
};
