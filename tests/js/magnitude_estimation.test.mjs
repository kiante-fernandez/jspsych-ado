import { test } from "node:test";
import assert from "node:assert/strict";
import model, {
  predictedLogMean,
  responseDensity,
  responseDensityFactory,
  responseMoments,
  conditionalEntropy,
  responseSampler,
  buildData,
} from "../../src/models/magnitude_estimation/model.js";
import { validateModel } from "../../src/index.js";
import { createDesignScorer, samplePriorDraws } from "../../src/ado/mi_engine.js";
import { createSeededRng } from "../../src/ado/ado_simulation.js";

test("magnitude_estimation validates as a continuous model package", () => {
  const { valid, problems } = validateModel(model);
  assert.equal(valid, true, JSON.stringify(problems));
});

test("predictedLogMean is the log-log linear predictor loga + b*log(s)", () => {
  const draw = { loga: -1.5, b: 0.7, sigma: 0.25 };
  assert.ok(Math.abs(predictedLogMean({ s: 100 }, draw) - (-1.5 + 0.7 * Math.log(100))) < 1e-12);
});

test("responseDensity and responseDensityFactory agree (the engine probe enforces this)", () => {
  const design = { s: 250 };
  const draw = { loga: -1.5, b: 0.7, sigma: 0.3 };
  const fast = responseDensityFactory(design, draw);
  for (const y of [-1, 0, 1, 2, 3.5]) {
    assert.ok(Math.abs(fast(y) - responseDensity(design, draw, y)) < 1e-12, `mismatch at y=${y}`);
  }
});

test("responseDensity integrates to ~1 over its support", () => {
  const design = { s: 100 };
  const draw = { loga: -1.5, b: 0.7, sigma: 0.3 };
  const mean = predictedLogMean(design, draw);
  const lo = mean - 10 * draw.sigma;
  const hi = mean + 10 * draw.sigma;
  const n = 4000;
  const h = (hi - lo) / n;
  let area = 0;
  for (let i = 0; i <= n; i++) {
    const w = i === 0 || i === n ? 0.5 : 1;
    area += w * responseDensity(design, draw, lo + i * h);
  }
  area *= h;
  assert.ok(Math.abs(area - 1) < 1e-3, `density integrated to ${area}`);
});

test("responseMoments returns the predicted log-mean and sigma", () => {
  const design = { s: 50 };
  const draw = { loga: 0.2, b: 0.9, sigma: 0.4 };
  const m = responseMoments(design, draw);
  assert.ok(Math.abs(m.mean - predictedLogMean(design, draw)) < 1e-12);
  assert.equal(m.sd, 0.4);
});

test("conditionalEntropy is the closed-form Gaussian differential entropy of sigma", () => {
  // Pin the absolute value (0.5*ln(2*pi*e*sigma^2)) computed independently, so a
  // wrong magnitude or sign is caught (not just delegating to the engine helper).
  const sigma = 0.3;
  const expected = 0.5 * Math.log(2 * Math.PI * Math.E * sigma * sigma);
  assert.ok(Math.abs(conditionalEntropy({ s: 10 }, { loga: 0, b: 1, sigma }) - expected) < 1e-12);
  // It is homoscedastic: independent of the design magnitude.
  assert.equal(
    conditionalEntropy({ s: 10 }, { loga: 0, b: 1, sigma }),
    conditionalEntropy({ s: 1000 }, { loga: 0, b: 1, sigma }),
  );
});

test("responseSampler is deterministic at sigma=0 (returns the predicted log-mean)", () => {
  const design = { s: 80 };
  const params = { loga: -1, b: 0.8, sigma: 0 };
  assert.ok(
    Math.abs(
      responseSampler(design, params, createSeededRng(1)) - predictedLogMean(design, params),
    ) < 1e-12,
  );
});

test("buildData logs s into log_s and passes the (already-log) response as log_y", () => {
  const data = buildData([
    { s: 100, choice: 2.3 },
    { s: 10, choice: 0.5 },
  ]);
  assert.equal(data.N, 2);
  assert.deepEqual(data.log_s, [Math.log(100), Math.log(10)]);
  assert.deepEqual(data.log_y, [2.3, 0.5]);
});

test("buildData rejects a non-positive magnitude (log_s would be -Inf/NaN)", () => {
  assert.throws(() => buildData([{ s: 0, choice: 1.0 }]), /log_s is not finite/);
});

test("buildData rejects a non-finite response (e.g. a raw estimate of 0 logged to -Inf)", () => {
  assert.throws(() => buildData([{ s: 100, choice: -Infinity }]), /log_y is not finite/);
});

test("createDesignScorer: continuous MI rises monotonically with magnitude under the prior", () => {
  // For this homoscedastic log-log model, EIG grows with (log s - posterior intercept)^2.
  // Under the prior the intercept sits below the grid, so MI is strictly increasing in s
  // and ADO concentrates on the largest magnitude first (D-optimal endpoint for a slope).
  // A monotone sweep is a real check: a broken density would not produce clean monotonicity.
  const draws = samplePriorDraws(model.prior, 4000, createSeededRng(42));
  const scorer = createDesignScorer(model);
  const grid = [10, 25, 50, 100, 250, 500, 1000];
  const mis = grid.map((s) => scorer.mutualInfo({ s }, draws));
  assert.ok(
    mis.every((v) => v > 0),
    "all MI positive",
  );
  for (let i = 1; i < mis.length; i++) {
    assert.ok(
      mis[i] > mis[i - 1],
      `MI should increase with s: ${grid[i - 1]}->${mis[i - 1].toFixed(3)} vs ${grid[i]}->${mis[i].toFixed(3)}`,
    );
  }
});
