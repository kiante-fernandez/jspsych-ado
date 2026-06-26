import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerTask,
  registerModelPackage,
  validateTask,
  validateModel,
  validateTaskModelPair,
  buildAdapter,
} from "../../src/index.js";
import { createDesignScorer, gaussianEntropy } from "../../src/ado/mi_engine.js";
import { simulateContinuousResponse, createSeededRng } from "../../src/ado/ado_simulation.js";

// End-to-end facade support for a continuous (pseudo-continuous) response: a model
// supplies a density + moments instead of a probability vector, and a task carries
// no response labels. Uses a linear-Gaussian estimation model y ~ Normal(theta*x, sigma).

const SIGMA = 1.0;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

function continuousModelPackage(overrides = {}) {
  return {
    id: "cont_est",
    params: ["theta"],
    designKeys: ["x"],
    responseSpace: { type: "continuous" },
    prior: { theta: { dist: "normal", mean: 0, sd: 2 } },
    moduleUrl: "https://example.test/main.js",
    wasmUrl: "https://example.test/main.wasm",
    stanData: { y: "response", x: "x" },
    responseDensity: (d, draw, y) => {
      const z = (y - draw.theta * d.x) / SIGMA;
      return Math.exp(-0.5 * z * z) / (SIGMA * SQRT_2PI);
    },
    responseDensityFactory: (d, draw) => {
      const mean = draw.theta * d.x;
      const inv = 1 / (SIGMA * SQRT_2PI);
      return (y) => {
        const z = (y - mean) / SIGMA;
        return Math.exp(-0.5 * z * z) * inv;
      };
    },
    responseMoments: (d, draw) => ({ mean: draw.theta * d.x, sd: SIGMA }),
    conditionalEntropy: () => gaussianEntropy(SIGMA),
    responseSampler: (d, params, rng) => params.theta * d.x + SIGMA * (rng() - 0.5),
    ...overrides,
  };
}

function continuousTask(overrides = {}) {
  return {
    id: "cont_task",
    design_grid: { x: [0.5, 1, 2] },
    designKeys: ["x"],
    responseSpace: { type: "continuous" },
    // Presentation is the task's concern; any trial yielding a number works (slider,
    // numeric input, ...). A getChoiceTrials stub is enough for validation here.
    presentation: { getChoiceTrials: () => [] },
    ...overrides,
  };
}

test("validateModel: a continuous model package validates", () => {
  const { valid, problems } = validateModel(continuousModelPackage());
  assert.equal(valid, true, JSON.stringify(problems));
});

test("validateModel: continuous model without responseDensity is rejected", () => {
  const { valid, problems } = validateModel(continuousModelPackage({ responseDensity: undefined }));
  assert.equal(valid, false);
  assert.ok(problems.some((p) => /responseDensity/.test(p.message)));
});

test("validateModel: continuous model without moments or support is rejected", () => {
  const { valid, problems } = validateModel(
    continuousModelPackage({ responseMoments: undefined, responseSupport: undefined }),
  );
  assert.equal(valid, false);
  assert.ok(problems.some((p) => /responseMoments|responseSupport/.test(p.message)));
});

test("validateTask: a continuous task needs no response_labels", () => {
  const { valid, problems } = validateTask(continuousTask());
  assert.equal(valid, true, JSON.stringify(problems));
});

test("buildAdapter: forwards continuous fields, and the adapter drives the engine scorer", () => {
  const spec = continuousModelPackage();
  const adapter = buildAdapter({
    spec,
    name: "cont_est",
    paramNames: ["theta"],
    prior: spec.prior,
    moduleUrl: spec.moduleUrl,
    wasmUrl: spec.wasmUrl,
  });
  assert.equal(typeof adapter.responseDensity, "function");
  assert.equal(typeof adapter.responseDensityFactory, "function");
  assert.equal(typeof adapter.responseMoments, "function");
  assert.equal(typeof adapter.conditionalEntropy, "function");
  assert.equal(typeof adapter.responseSampler, "function");

  // The controller feeds exactly this adapter to createDesignScorer; confirm it routes
  // to the continuous path and produces a positive MI for an informative design.
  const scorer = createDesignScorer(adapter);
  const draws = [{ theta: -1 }, { theta: 0 }, { theta: 1 }, { theta: 2 }];
  assert.ok(scorer.mutualInfo({ x: 2 }, draws) > 0);
});

test("validateTaskModelPair: a matching continuous task/model pair passes", () => {
  const spec = continuousModelPackage();
  const adapter = buildAdapter({
    spec,
    name: "cont_est",
    paramNames: ["theta"],
    prior: spec.prior,
    moduleUrl: spec.moduleUrl,
    wasmUrl: spec.wasmUrl,
  });
  assert.doesNotThrow(() =>
    validateTaskModelPair(continuousTask(), adapter, "cont_task", "cont_est"),
  );
});

test("validateTaskModelPair: a responseDensityFactory that disagrees with responseDensity is caught", () => {
  const spec = continuousModelPackage({ responseDensityFactory: () => () => 0.123 });
  const adapter = buildAdapter({
    spec,
    name: "cont_est",
    paramNames: ["theta"],
    prior: spec.prior,
    moduleUrl: spec.moduleUrl,
    wasmUrl: spec.wasmUrl,
  });
  assert.throws(
    () => validateTaskModelPair(continuousTask(), adapter, "cont_task", "cont_est"),
    /disagrees/,
  );
});

test("validateTaskModelPair: a bad continuous density (negative) is caught by the probe", () => {
  const spec = continuousModelPackage({ responseDensity: () => -1 });
  const adapter = buildAdapter({
    spec,
    name: "cont_est",
    paramNames: ["theta"],
    prior: spec.prior,
    moduleUrl: spec.moduleUrl,
    wasmUrl: spec.wasmUrl,
  });
  assert.throws(
    () => validateTaskModelPair(continuousTask(), adapter, "cont_task", "cont_est"),
    /density probe/,
  );
});

test("registerModelPackage + registerTask: a continuous pair registers without error", () => {
  registerTask("cont_task_reg", continuousTask({ id: "cont_task_reg" }));
  const name = registerModelPackage(continuousModelPackage({ id: "cont_est_reg" }));
  assert.equal(name, "cont_est_reg");
});

test("registerModelPackage: continuous model missing responseDensity throws", () => {
  assert.throws(
    () =>
      registerModelPackage(continuousModelPackage({ id: "cont_bad", responseDensity: undefined })),
    /responseDensity/,
  );
});

// --- Simulator ---

test("simulateContinuousResponse: draws a real response and records sim_* fields", () => {
  const model = { responseSampler: (d, params) => params.theta * d.x };
  const data = simulateContinuousResponse(
    { x: 2 },
    { params: { theta: 1.5 }, rt: { choice: 300 } },
    createSeededRng(1),
    model,
  );
  assert.equal(data.response, 3);
  assert.equal(data.sim_response, 3);
  assert.equal(data.sim_theta, 1.5);
  assert.equal(data.rt, 300);
});

test("simulateContinuousResponse: requires a responseSampler", () => {
  assert.throws(
    () =>
      simulateContinuousResponse(
        { x: 1 },
        { params: {}, rt: { choice: 1 } },
        createSeededRng(1),
        {},
      ),
    /responseSampler/,
  );
});

test("simulateContinuousResponse: rejects a non-finite sampled response", () => {
  assert.throws(
    () =>
      simulateContinuousResponse({ x: 1 }, { params: {}, rt: { choice: 1 } }, createSeededRng(1), {
        responseSampler: () => NaN,
      }),
    /finite number/,
  );
});
