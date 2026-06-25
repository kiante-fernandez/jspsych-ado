// Stevens' power-law magnitude-estimation adapter (a CONTINUOUS-response model).
//
// Likelihood (mirrors magnitude_estimation.stan), in log-log space:
//   log(estimate) ~ Normal(loga + b * log(s), sigma)
// so the response carried through the ADO pipeline is y = log(estimate) and the
// design covariate is s (the physical magnitude); buildData logs s -> log_s and
// passes the already-logged response as log_y. The headline parameter is the
// Stevens exponent b.
//
// As always, this JS likelihood is the single source consumed by THREE places and
// they must agree with the .stan:
//   - responseDensity / responseDensityFactory : the engine integrates them for EIG,
//   - responseSampler : the simulated participant draws from it,
//   - the .stan model  : Stan fits it.

import { gaussianEntropy, standardNormal } from "../../ado/mi_engine.js";

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normalPdf(y, mean, sd) {
  const z = (y - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * SQRT_2PI);
}

// Predicted mean of log(estimate) for a design under one parameter draw.
function predictedLogMean(design, draw) {
  return draw.loga + draw.b * Math.log(design.s);
}

/**
 * Predictive density of the log-response given parameters and a design.
 *
 * @param {Object} design - { s } physical magnitude.
 * @param {Object} draw - { loga, b, sigma }.
 * @param {number} y - Candidate log(estimate).
 * @returns {number} p(y | theta, design) >= 0.
 */
function responseDensity(design, draw, y) {
  return normalPdf(y, predictedLogMean(design, draw), draw.sigma);
}

/**
 * Fast path for the MI integration hot loop: hoist the per-(design, draw) mean and
 * normalizer out so each quadrature node only does (y - mean), a square, and one exp.
 * Must compute the same density as responseDensity (a registration probe checks this).
 *
 * @param {Object} design - { s }.
 * @param {Object} draw - { loga, b, sigma }.
 * @returns {Function} (y) => p(y | theta, design).
 */
function responseDensityFactory(design, draw) {
  const mean = predictedLogMean(design, draw);
  const sd = draw.sigma;
  const inv = 1 / (sd * SQRT_2PI);
  return (y) => {
    const z = (y - mean) / sd;
    return Math.exp(-0.5 * z * z) * inv;
  };
}

/**
 * Conditional mean/sd of the log-response; drives the auto-derived integration support.
 *
 * @param {Object} design - { s }.
 * @param {Object} draw - { loga, b, sigma }.
 * @returns {{mean: number, sd: number}}
 */
function responseMoments(design, draw) {
  return { mean: predictedLogMean(design, draw), sd: draw.sigma };
}

/**
 * Closed-form differential entropy of the Gaussian log-response given the draw.
 *
 * @param {Object} design - { s } (unused; noise is homoscedastic in log space).
 * @param {Object} draw - { loga, b, sigma }.
 * @returns {number} H(Y | theta, design) = 0.5*ln(2*pi*e*sigma^2) nats.
 */
function conditionalEntropy(design, draw) {
  return gaussianEntropy(draw.sigma);
}

/**
 * Draw one simulated log(estimate) from the model likelihood.
 *
 * @param {Object} design - { s }.
 * @param {Object} params - Data-generating { loga, b, sigma }.
 * @param {Function} rng - Seeded uniform RNG in [0, 1).
 * @returns {number} A simulated log(estimate).
 */
function responseSampler(design, params, rng) {
  return predictedLogMean(design, params) + params.sigma * standardNormal(rng);
}

/**
 * Assemble the Stan data block. The design carries the physical magnitude s, which
 * we log into the covariate log_s; the response `choice` is already log(estimate)
 * (the task's responseToOutcome logs the slider estimate), so it maps straight to log_y.
 *
 * @param {Array<Object>} trials - Rows of { s, choice } (choice = log estimate).
 * @returns {Object} Stan data { N, log_s, log_y }.
 */
function buildData(trials) {
  const log_s = trials.map((t) => Math.log(t.s));
  const log_y = trials.map((t) => t.choice);
  // Backstop the log-space convention: a non-positive magnitude (log_s = -Inf/NaN) or a
  // response that is not a finite log(estimate) (e.g. the task forwarded a raw estimate
  // of 0) must fail loudly here, not silently poison the Stan likelihood.
  for (let i = 0; i < trials.length; i++) {
    if (!Number.isFinite(log_s[i])) {
      throw new Error(
        `magnitude_estimation.buildData: log_s is not finite at row ${i} (s=${trials[i].s}); magnitudes must be > 0.`,
      );
    }
    if (!Number.isFinite(log_y[i])) {
      throw new Error(
        `magnitude_estimation.buildData: log_y is not finite at row ${i} (choice=${trials[i].choice}); ` +
          `the response must be log(estimate) with estimate > 0 (the task's responseToOutcome logs it).`,
      );
    }
  }
  return { N: trials.length, log_s, log_y };
}

const magnitudeEstimationModel = {
  id: "magnitude_estimation",
  params: ["loga", "b", "sigma"],
  designKeys: ["s"],
  responseSpace: { type: "continuous" },
  prior: {
    loga: { dist: "normal", mean: 0, sd: 2 },
    b: { dist: "normal", mean: 0.7, sd: 0.5 },
    sigma: { dist: "halfnormal", sd: 0.5 },
  },
  posterior_display: {
    loga: { label: "log a (scale)", y_min: -3, y_max: 3 },
    b: { label: "b (Stevens exponent)", y_min: 0, y_max: 2, lower_bound: 0 },
    sigma: { label: "sigma (log-noise)", y_min: 0, y_max: 1.5, lower_bound: 0 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  // Statically referenced so bundlers emit the .wasm asset; the worker feeds this
  // to emscripten's locateFile so the wasm loads after bundling (see ado/stan_worker.js).
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  buildData,
  responseDensity,
  responseDensityFactory,
  responseMoments,
  conditionalEntropy,
  responseSampler,
};

export default magnitudeEstimationModel;
export {
  SQRT_2PI,
  normalPdf,
  predictedLogMean,
  buildData,
  responseDensity,
  responseDensityFactory,
  responseMoments,
  conditionalEntropy,
  responseSampler,
  magnitudeEstimationModel,
};
