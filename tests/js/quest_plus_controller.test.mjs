import { test } from "node:test";
import assert from "node:assert/strict";

import QuestPlus from "../../core/jsquest-plus/jsQuestPlus.module.js";
import {
  clipResponseProbs,
  createQuestPlusController,
  makeQuestPlusPriorWeights,
  priorDensity,
} from "../../jspsych-ado/controllers/quest_plus_controller.js";

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

const TEST_MODEL = {
  params: ["k", "tau"],
  prior: {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
  },
  responseProb: (design, params) => logistic(params.tau * (design.value - params.k)),
};

const TEST_CATEGORICAL_MODEL = {
  params: ["sensitivity", "bias_b"],
  responseSpace: { type: "categorical", n_categories: 3 },
  prior: {
    sensitivity: { dist: "lognormal", meanlog: 0, sdlog: 0.5 },
    bias_b: { dist: "normal", mean: 0, sd: 0.5 },
  },
  responseProbs: (design, params) => {
    const values = [
      design.target === 0 ? params.sensitivity : 0,
      design.target === 1 ? params.sensitivity + params.bias_b : params.bias_b,
      design.target === 2 ? params.sensitivity : 0,
    ];
    const max_value = Math.max(...values);
    const exp_values = values.map(value => Math.exp(value - max_value));
    const total = exp_values.reduce((sum, value) => sum + value, 0);
    return exp_values.map(value => value / total);
  },
};

test("priorDensity supports the model-package prior families", () => {
  assert.ok(priorDensity(0.01, { dist: "lognormal", meanlog: -4, sdlog: 2 }) > 0);
  assert.ok(priorDensity(0, { dist: "normal", mean: 0, sd: 1 }) > 0);
  assert.ok(priorDensity(0, { dist: "halfnormal", sd: 1 }) > 0);
  assert.equal(priorDensity(-1, { dist: "halfnormal", sd: 1 }), 0);
});

test("makeQuestPlusPriorWeights normalizes model priors over parameter samples", () => {
  const weights = makeQuestPlusPriorWeights(TEST_MODEL, {
    k: [1e-4, 1e-3, 1e-2],
    tau: [0.5, 2.5, 5],
  });

  assert.equal(weights.length, 2);
  for (const param_weights of weights) {
    assert.ok(param_weights.every(Number.isFinite));
    assert.ok(param_weights.every(value => value >= 0));
    assert.ok(Math.abs(param_weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  }
});

test("clipResponseProbs clips zeros and renormalizes categorical vectors", () => {
  const clipped = clipResponseProbs([1, 0, 0]);
  assert.equal(clipped.length, 3);
  assert.ok(clipped.every(value => value > 0));
  assert.ok(Math.abs(clipped.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});

test("createQuestPlusController follows the ADO controller start/update contract", async () => {
  const controller = createQuestPlusController({
    QuestPlus,
    model: TEST_MODEL,
    grid_design: [
      { value: 0.1 },
      { value: 0.5 },
      { value: 1.0 },
    ],
    quest_plus: {
      parameter_samples: {
        k: [0.001, 0.01],
        tau: [0.5, 2.5],
      },
    },
    session_id: "quest-test",
    n_trials: 2,
  });

  const started = await controller.start();
  assert.equal(started.session_id, "quest-test");
  assert.equal(started.trial_index, 0);
  assert.equal(started.post_mean, null);
  assert.equal(started.post_sd, null);
  assert.ok(started.next_design);

  const updated = await controller.update({
    ado_design: started.next_design,
    choice: 1,
  });
  assert.equal(updated.session_id, "quest-test");
  assert.equal(updated.trial_index, 1);
  assert.equal(typeof updated.post_mean.k, "number");
  assert.equal(typeof updated.post_sd.tau, "number");
  assert.ok(Number.isFinite(updated.post_mean.k));
  assert.ok(Number.isFinite(updated.post_sd.tau));
  assert.ok(updated.next_design);

  const final = await controller.update({
    ado_design: updated.next_design,
    choice: 0,
  });
  assert.equal(final.trial_index, 2);
  assert.equal(final.next_design, null);
});

test("createQuestPlusController supports 3-category responseProbs models", async () => {
  const controller = createQuestPlusController({
    QuestPlus,
    model: TEST_CATEGORICAL_MODEL,
    grid_design: [
      { target: 0 },
      { target: 1 },
      { target: 2 },
    ],
    quest_plus: {
      parameter_samples: {
        sensitivity: [0.8, 1.5],
        bias_b: [-0.5, 0, 0.5],
      },
    },
    session_id: "quest-categorical-test",
    n_trials: 2,
  });

  const started = await controller.start();
  assert.equal(started.session_id, "quest-categorical-test");
  assert.ok(started.next_design);

  const updated = await controller.update({
    ado_design: started.next_design,
    choice: 2,
  });
  assert.equal(updated.trial_index, 1);
  assert.equal(typeof updated.post_mean.sensitivity, "number");
  assert.equal(typeof updated.post_sd.bias_b, "number");
  assert.ok(Number.isFinite(updated.post_mean.sensitivity));
  assert.ok(updated.next_design);
});
