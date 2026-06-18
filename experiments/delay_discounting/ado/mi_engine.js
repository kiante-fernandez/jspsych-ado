// Generic adaptive-design-optimization (ADO) math, shared by every model.
//
// This module is model-agnostic: it never references hyperbolic discounting,
// k, or tau. A model supplies a `choiceProbLL(design, paramDraw)` likelihood and
// the engine computes mutual information (MI) over a candidate design grid from
// posterior draws. Swapping the Stan model never requires editing this file.
//
// Posterior draws are passed as an array of plain objects, one per draw, keyed by
// parameter name, e.g. [{k: 0.01, tau: 1.2}, ...]. The same shape is produced for
// prior draws (first trial) and for Stan posterior draws (later trials).

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
 * Expected information gain (mutual information between the binary response and
 * the parameters) for one candidate design, estimated from posterior draws.
 *
 * MI(d) = H( mean_s p_s ) - mean_s H( p_s ), where p_s = choiceProbLL(d, draw_s).
 *
 * @param {Object} design - Candidate design (e.g. {t_ss, t_ll, r_ss, r_ll}).
 * @param {Array<Object>} draws - Posterior/prior draws, one object per draw.
 * @param {Function} choiceProbLL - Model likelihood: (design, draw) -> P(response=1).
 * @returns {number} Estimated mutual information for the design (nats).
 */
function mutualInfo(design, draws, choiceProbLL) {
  const n = draws.length;
  let sumP = 0;
  let sumCondEntropy = 0;
  for (let s = 0; s < n; s++) {
    const p = choiceProbLL(design, draws[s]);
    sumP += p;
    sumCondEntropy += binaryEntropy(p);
  }
  const meanP = sumP / n;
  const condEntropy = sumCondEntropy / n;
  return binaryEntropy(meanP) - condEntropy;
}

/**
 * Realized information gain after observing one binary response to a design.
 *
 * This is KL(p(theta | y, d) || p(theta)) estimated from the pre-trial posterior
 * draws via likelihood weighting. Its expectation over y is the mutual
 * information for the design.
 *
 * @param {Object} design - Presented design.
 * @param {Array<Object>} draws - Pre-response posterior/prior draws.
 * @param {number} choice - Observed response, 1 for LL and 0 for SS.
 * @param {Function} choiceProbLL - Model likelihood: (design, draw) -> P(response=1).
 * @returns {number} Realized information gain in nats.
 */
function realizedInformationGain(design, draws, choice, choiceProbLL) {
  const likelihoods = [];
  for (const draw of draws) {
    const p_ll = choiceProbLL(design, draw);
    const likelihood = choice === 1 ? p_ll : 1 - p_ll;
    if (Number.isFinite(likelihood) && likelihood >= 0) {
      likelihoods.push(likelihood);
    }
  }

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
 * Expand a design grid (object of value arrays) into every design combination.
 *
 * @param {Object} grid_design - e.g. {t_ss: [...], t_ll: [...], r_ss: [...], r_ll: [...]}.
 * @returns {Array<Object>} Cartesian product of the grid as design objects.
 */
function enumerateDesigns(grid_design) {
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
 * Pick the design that maximizes mutual information (the ADO step). Takes an
 * already-enumerated design list so callers can enumerate the constant grid once
 * (see enumerateDesigns).
 *
 * @param {Array<Object>} designs - Candidate designs to score.
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} choiceProbLL - Model likelihood.
 * @returns {{design: Object, mutual_info: number}} Best design and its MI.
 */
function selectOptimalDesign(designs, draws, choiceProbLL) {
  let best_design = null;
  let best_mi = -Infinity;
  for (const design of designs) {
    const mi = mutualInfo(design, draws, choiceProbLL);
    if (mi > best_mi) {
      best_mi = mi;
      best_design = design;
    }
  }
  return { design: best_design, mutual_info: best_mi };
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
  binaryEntropy,
  mutualInfo,
  realizedInformationGain,
  enumerateDesigns,
  selectOptimalDesign,
  summarizeDraws,
  samplePriorDraws,
};
