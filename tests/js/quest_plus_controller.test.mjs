import { test } from "node:test";
import assert from "node:assert/strict";

import QuestPlus from "../../core/jsquest-plus/jsQuestPlus.module.js";
import {
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
