import { test } from "node:test";
import assert from "node:assert/strict";
import { createController, validateModel, buildModelAdapter } from "../../src/index.js";
import { validateDesignGridForModel } from "../../src/validation.js";
import { createDesignScorer, gaussianEntropy } from "../../src/ado/mi_engine.js";
import { simulateContinuousResponse, createSeededRng } from "../../src/ado/ado_simulation.js";
import { runFragment } from "./_timeline_harness.mjs";

// End-to-end facade support for a continuous (pseudo-continuous) response: a model
// supplies a density + moments instead of a probability vector, and the trials carry
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

const CONT_GRID = { x: [0.5, 1, 2] };

const jsPsychStub = { abortExperiment() {} };

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

test("buildModelAdapter: forwards continuous fields, and the adapter drives the engine scorer", () => {
  const adapter = buildModelAdapter(continuousModelPackage(), "test");
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

test("validateDesignGridForModel: a matching continuous grid/model pair passes", () => {
  const adapter = buildModelAdapter(continuousModelPackage(), "test");
  assert.doesNotThrow(() => validateDesignGridForModel(CONT_GRID, adapter, "cont_est"));
});

test("validateDesignGridForModel: a responseDensityFactory that disagrees with responseDensity is caught", () => {
  const adapter = buildModelAdapter(
    continuousModelPackage({ responseDensityFactory: () => () => 0.123 }),
    "test",
  );
  assert.throws(() => validateDesignGridForModel(CONT_GRID, adapter, "cont_est"), /disagrees/);
});

test("validateDesignGridForModel: a bad continuous density (negative) is caught by the probe", () => {
  const adapter = buildModelAdapter(continuousModelPackage({ responseDensity: () => -1 }), "test");
  assert.throws(() => validateDesignGridForModel(CONT_GRID, adapter, "cont_est"), /density probe/);
});

test("createController: a continuous model builds a controller handle without error", () => {
  const ado = createController(jsPsychStub, {
    model: continuousModelPackage({ id: "cont_est_ctrl" }),
    design_grid: CONT_GRID,
    controller: "mock",
  });
  assert.equal(typeof ado.createTimeline, "function");
});

test("createController: continuous model missing responseDensity throws", () => {
  assert.throws(
    () =>
      createController(jsPsychStub, {
        model: continuousModelPackage({ id: "cont_bad", responseDensity: undefined }),
        design_grid: CONT_GRID,
      }),
    /responseDensity/,
  );
});

test("controller API run: a continuous response records a numeric choice with no label", async () => {
  const ado = createController(jsPsychStub, {
    model: continuousModelPackage({ id: "cont_run" }),
    design_grid: CONT_GRID,
    controller: "mock",
  });
  const trial = {
    type: "canvas-slider-response",
    stimulus: () => `estimate for x=${ado.evaluateDesignVariable("x")}`,
    on_finish: (data) => ado.recordResponse(Number(data.response)),
  };
  const { rows } = await runFragment(
    ado.createTimeline(trial, { n_trials: 2, debug: false }),
    () => ({
      response: 42.5,
    }),
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].choice, 42.5);
  assert.equal(rows[0].choice_label, null);
  assert.equal(typeof rows[0].ado_design.x, "number");
});

test("controller API run: a non-finite continuous response is rejected", async () => {
  const ado = createController(jsPsychStub, {
    model: continuousModelPackage({ id: "cont_nan" }),
    design_grid: CONT_GRID,
    controller: "mock",
  });
  const trial = { type: "x", stimulus: "s", on_finish: (d) => ado.recordResponse(d.response) };
  const root = ado.createTimeline(trial, { n_trials: 1, debug: false })[0];
  root.on_timeline_start();
  const t = root.timeline[0].timeline[0];
  await assert.rejects(() => t.on_finish({ response: "very long" }), /finite numeric response/);
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
