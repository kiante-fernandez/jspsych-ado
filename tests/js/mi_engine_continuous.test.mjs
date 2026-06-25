import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDesignScorer,
  gaussianEntropy,
  makeContinuousSupportResolver,
  mutualInfo,
  mutualInfoContinuous,
  realizedInformationGainContinuous,
  samplePriorDraws,
} from "../../src/ado/mi_engine.js";
import { createSeededRng } from "../../src/ado/ado_simulation.js";

// Continuous EIG by 1-D quadrature. The correctness anchor is the linear-Gaussian
// model y ~ Normal(theta * x, sigma) with a Gaussian prior theta ~ Normal(m, v),
// whose EIG has the closed form 0.5 * ln(1 + x^2 * v / sigma^2). This pins the
// estimator to a known truth, not just "it recovers parameters".

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normalPdf(y, mean, sd) {
  const z = (y - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * SQRT_2PI);
}

test("mutualInfoContinuous: quadrature of a single Gaussian recovers its differential entropy", () => {
  // One draw => the predictive is exactly that Gaussian (no mixture approximation),
  // and conditionalEntropy=0 makes the return value the marginal entropy term alone.
  const sigma = 1.3;
  const design = { x: 1 };
  const draws = [{ theta: 0.5 }];
  const density = (d, draw, y) => normalPdf(y, draw.theta * d.x, sigma);
  const mean = 0.5;
  const support = [mean - 10 * sigma, mean + 10 * sigma];

  const marginal = mutualInfoContinuous(design, draws, density, {
    support,
    intervals: 512,
    conditionalEntropy: () => 0,
  });
  assert.ok(
    Math.abs(marginal - gaussianEntropy(sigma)) < 1e-3,
    `marginal entropy ${marginal} vs ${gaussianEntropy(sigma)}`,
  );
});

test("mutualInfoContinuous: a single draw gives EIG ~ 0 (predictive == conditional)", () => {
  // With one draw, the marginal and the conditional are integrated from the same
  // integrand on the same mesh, so the quadrature-fallback EIG is exactly 0.
  const sigma = 1.0;
  const design = { x: 1 };
  const draws = [{ theta: 0.5 }];
  const density = (d, draw, y) => normalPdf(y, draw.theta * d.x, sigma);
  const support = [0.5 - 10 * sigma, 0.5 + 10 * sigma];

  const eig = mutualInfoContinuous(design, draws, density, { support, intervals: 512 });
  assert.ok(eig < 1e-9, `single-draw fallback EIG should be ~0, got ${eig}`);
});

test("mutualInfoContinuous: linear-Gaussian EIG matches the analytic 0.5 ln(1 + x^2 v / sigma^2)", () => {
  const sigma = 1.0;
  const priorMean = 0.0;
  const priorVar = 4.0; // v
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: priorMean, sd: Math.sqrt(priorVar) } },
    12000,
    createSeededRng(20240619),
  );
  const density = (d, draw, y) => normalPdf(y, draw.theta * d.x, sigma);
  const conditionalEntropy = () => gaussianEntropy(sigma);

  for (const x of [0.5, 1.0, 2.0]) {
    const predMean = priorMean * x;
    const predSd = Math.sqrt(x * x * priorVar + sigma * sigma);
    const support = [predMean - 8 * predSd, predMean + 8 * predSd];
    const eig = mutualInfoContinuous({ x }, draws, density, {
      support,
      intervals: 400,
      conditionalEntropy,
    });
    const analytic = 0.5 * Math.log(1 + (x * x * priorVar) / (sigma * sigma));
    assert.ok(Math.abs(eig - analytic) < 0.03, `x=${x}: EIG ${eig} vs analytic ${analytic}`);
  }
});

test("mutualInfoContinuous: EIG increases with a more informative (larger |x|) design", () => {
  const sigma = 1.0;
  const priorVar = 4.0;
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: 0, sd: Math.sqrt(priorVar) } },
    6000,
    createSeededRng(7),
  );
  const density = (d, draw, y) => normalPdf(y, draw.theta * d.x, sigma);
  const conditionalEntropy = () => gaussianEntropy(sigma);
  const eigAt = (x) => {
    const predSd = Math.sqrt(x * x * priorVar + sigma * sigma);
    return mutualInfoContinuous({ x }, draws, density, {
      support: [-8 * predSd, 8 * predSd],
      intervals: 400,
      conditionalEntropy,
    });
  };
  assert.ok(eigAt(2) > eigAt(0.5), "a larger design should be more informative");
});

test("mutualInfoContinuous: requires a finite support", () => {
  assert.throws(
    () => mutualInfoContinuous({ x: 1 }, [{ theta: 0 }], () => 1, {}),
    /finite integration support/,
  );
});

test("mutualInfoContinuous: rejects a negative or non-finite density", () => {
  assert.throws(
    () => mutualInfoContinuous({ x: 1 }, [{ theta: 0 }], () => -1, { support: [-1, 1] }),
    /finite and nonnegative/,
  );
});

test("mutualInfoContinuous: empty draws give 0", () => {
  assert.equal(
    mutualInfoContinuous({ x: 1 }, [], () => 1, { support: [-1, 1] }),
    0,
  );
});

test("mutualInfoContinuous: densityFactory fast path equals the plain densityFn path", () => {
  const sigma = 1.0;
  const priorVar = 4.0;
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: 0, sd: Math.sqrt(priorVar) } },
    3000,
    createSeededRng(99),
  );
  const density = (d, draw, y) => normalPdf(y, draw.theta * d.x, sigma);
  // Hoisted-constants evaluator: same density, mean + normalizer computed once per draw.
  const densityFactory = (d, draw) => {
    const mean = draw.theta * d.x;
    const inv = 1 / (sigma * SQRT_2PI);
    return (y) => {
      const z = (y - mean) / sigma;
      return Math.exp(-0.5 * z * z) * inv;
    };
  };
  const conditionalEntropy = () => gaussianEntropy(sigma);
  const x = 1.5;
  const predSd = Math.sqrt(x * x * priorVar + sigma * sigma);
  const support = [-8 * predSd, 8 * predSd];
  const plain = mutualInfoContinuous({ x }, draws, density, {
    support,
    intervals: 400,
    conditionalEntropy,
  });
  const fast = mutualInfoContinuous({ x }, draws, density, {
    support,
    intervals: 400,
    conditionalEntropy,
    densityFactory,
  });
  assert.ok(Math.abs(plain - fast) < 1e-9, `factory MI ${fast} vs plain ${plain}`);
});

// --- Dispatch seam: createDesignScorer + auto-support + continuous realized gain ---

const LINEAR_SIGMA = 1.0;
function linearGaussianModel() {
  return {
    responseSpace: { type: "continuous" },
    responseDensity: (d, draw, y) => normalPdf(y, draw.theta * d.x, LINEAR_SIGMA),
    responseMoments: (d, draw) => ({ mean: draw.theta * d.x, sd: LINEAR_SIGMA }),
    conditionalEntropy: () => gaussianEntropy(LINEAR_SIGMA),
  };
}

test("createDesignScorer: continuous scorer wires auto-support + density through to mutualInfoContinuous", () => {
  const model = linearGaussianModel();
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: 0, sd: 2 } },
    4000,
    createSeededRng(11),
  );
  const scorer = createDesignScorer(model);
  const design = { x: 1.5 };

  // Recompute the auto-support the scorer derives internally (extreme means +/- 8 sd)
  // and confirm the scorer's MI equals a direct call with that support: same math.
  const support = makeContinuousSupportResolver(model)(design, draws);
  const direct = mutualInfoContinuous(design, draws, model.responseDensity, {
    support,
    conditionalEntropy: model.conditionalEntropy,
  });
  assert.ok(
    Math.abs(scorer.mutualInfo(design, draws) - direct) < 1e-9,
    "scorer MI must match the direct call",
  );
});

test("createDesignScorer: continuous selection picks the most informative design", () => {
  const model = linearGaussianModel();
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: 0, sd: 2 } },
    4000,
    createSeededRng(3),
  );
  const scorer = createDesignScorer(model);
  const picks = scorer.selectOptimalDesigns([{ x: 0.2 }, { x: 1 }, { x: 3 }], draws, 1);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].design.x, 3); // larger |x| => more information about theta
  assert.ok(picks[0].mutual_info > 0);
});

test("createDesignScorer: continuous realized gain is positive for an observed response", () => {
  const model = linearGaussianModel();
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: 0, sd: 2 } },
    2000,
    createSeededRng(5),
  );
  const scorer = createDesignScorer(model);
  const gain = scorer.realizedInformationGain({ x: 2 }, draws, 3.4);
  assert.ok(Number.isFinite(gain) && gain > 0, `expected a positive finite gain, got ${gain}`);
});

test("createDesignScorer: discrete models still route to the discrete path unchanged", () => {
  const logistic = (z) => 1 / (1 + Math.exp(-z));
  const model = {
    responseSpace: { type: "binary" },
    responseProb: (d, draw) => logistic(draw.beta * d.x),
  };
  const draws = samplePriorDraws(
    { beta: { dist: "normal", mean: 0, sd: 1 } },
    1500,
    createSeededRng(9),
  );
  const scorer = createDesignScorer(model);
  const design = { x: 1.2 };
  const direct = mutualInfo(design, draws, (d, draw) => model.responseProb(d, draw));
  assert.equal(scorer.mutualInfo(design, draws), direct);
});

test("createDesignScorer: continuous model without responseDensity throws", () => {
  assert.throws(
    () => createDesignScorer({ responseSpace: { type: "continuous" } }),
    /responseDensity/,
  );
});

test("createDesignScorer: continuous model without support or moments throws", () => {
  assert.throws(
    () => createDesignScorer({ responseSpace: { type: "continuous" }, responseDensity: () => 1 }),
    /responseSupport.*responseMoments|automatic support/s,
  );
});

test("createDesignScorer: continuous testlet batching (count > 1) is rejected", () => {
  const model = linearGaussianModel();
  const draws = samplePriorDraws(
    { theta: { dist: "normal", mean: 0, sd: 1 } },
    100,
    createSeededRng(1),
  );
  const scorer = createDesignScorer(model);
  assert.throws(
    () => scorer.selectOptimalDesigns([{ x: 1 }, { x: 2 }], draws, 2),
    /testlet batching/,
  );
});

test("makeContinuousSupportResolver: explicit [lo, hi] and function forms are honored", () => {
  const fixed = makeContinuousSupportResolver({ responseSupport: [-2, 5] });
  assert.deepEqual(fixed({ x: 1 }, []), [-2, 5]);
  const fn = makeContinuousSupportResolver({ responseSupport: (d) => [0, d.x] });
  assert.deepEqual(fn({ x: 9 }, []), [0, 9]);
});

test("realizedInformationGainContinuous: rejects a non-finite response", () => {
  assert.throws(
    () => realizedInformationGainContinuous({ x: 1 }, [{ theta: 0 }], NaN, () => 1),
    /finite number/,
  );
});
