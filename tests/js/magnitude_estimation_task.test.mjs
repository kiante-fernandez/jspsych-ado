import { test } from "node:test";
import assert from "node:assert/strict";
import task, { responseToOutcome, design_grid } from "../../src/tasks/magnitude_estimation/task.js";
import model from "../../src/models/magnitude_estimation/model.js";
import { validateTask, validateTaskModelPair } from "../../src/index.js";
import { enumerateDesigns } from "../../src/ado/mi_engine.js";

test("magnitude_estimation task validates (continuous, no response_labels needed)", () => {
  const { valid, problems } = validateTask(task);
  assert.equal(valid, true, JSON.stringify(problems));
});

test("design_grid enumerates to the magnitude axis", () => {
  assert.deepEqual(
    enumerateDesigns(design_grid).map((d) => d.s),
    [10, 25, 50, 100, 250, 500, 1000],
  );
});

test("responseToOutcome maps the raw slider estimate into the modeled log-response", () => {
  assert.ok(Math.abs(responseToOutcome({ s: 100 }, 50) - Math.log(50)) < 1e-12);
  // A non-positive estimate is clamped so the modeled response stays finite (no -Inf).
  assert.ok(Number.isFinite(responseToOutcome({ s: 100 }, 0)));
  assert.ok(Number.isFinite(responseToOutcome({ s: 100 }, -5)));
});

test("getChoiceTrials yields exactly one response-collecting slider trial that records the raw value", () => {
  const ctx = {
    getDesign: () => ({ s: 100 }),
    getState: () => ({ session_id: "sess", trial_index: 0 }),
    run_context: {},
    trial_number: 1,
    task: "magnitude_estimation",
    // Inject a stub plugin class so the factory resolves without a browser global.
    plugins: { canvasSliderResponse: function StubSliderPlugin() {} },
  };
  const trials = task.presentation.getChoiceTrials(ctx);
  assert.equal(trials.length, 1);
  const trial = trials[0];
  assert.equal(trial.__ado_is_response, true);
  // The slider records its value as the raw response; responseToOutcome logs it later.
  const data = { response: 42 };
  trial.on_finish(data);
  assert.equal(data.__ado_response, 42);
});

test("the task/model pair validates together (matching design keys + continuous space)", () => {
  assert.doesNotThrow(() =>
    validateTaskModelPair(task, model, "magnitude_estimation", "magnitude_estimation"),
  );
});
