import { test } from "node:test";
import assert from "node:assert/strict";

import task, {
  correctChoiceIndex,
  makeDotComparisonDesigns,
  responseToOutcome,
} from "../../jspsych-ado/tasks/halberda_dot_comparison/task.js";
import model from "../../jspsych-ado/models/weber_dots/model.js";
import { validateTask, validateModel } from "../../jspsych-ado/index.js";

test("Halberda task package exposes an adaptive dot-comparison design list", () => {
  assert.equal(task.id, "halberda_dot_comparison");
  assert.ok(task.design_grid.length > 0);
  assert.deepEqual(task.responseSpace, { type: "binary" });
  assert.deepEqual(task.response_labels, { 0: "incorrect", 1: "correct" });
  assert.equal(typeof task.presentation.getChoiceTrials, "function");
});

test("design generation includes both color orders and visual-control modes", () => {
  const designs = makeDotComparisonDesigns({
    ratios: [{ small: 1, large: 2, label: "1:2" }],
    large_counts: [10],
    control_modes: ["size_control", "area_control"],
  });
  assert.equal(designs.length, 4);
  assert.ok(designs.some(d => d.n_blue === 10 && d.n_yellow === 5 && d.control_mode === "size_control"));
  assert.ok(designs.some(d => d.n_blue === 5 && d.n_yellow === 10 && d.control_mode === "area_control"));
});

test("raw B/Y responses map to model outcome correct/incorrect", () => {
  const blue_more = { n_blue: 20, n_yellow: 10 };
  const yellow_more = { n_blue: 10, n_yellow: 20 };

  assert.equal(correctChoiceIndex(blue_more), 0);
  assert.equal(correctChoiceIndex(yellow_more), 1);
  assert.equal(responseToOutcome(blue_more, 0), 1);
  assert.equal(responseToOutcome(blue_more, 1), 0);
  assert.equal(responseToOutcome(yellow_more, 0), 0);
  assert.equal(responseToOutcome(yellow_more, 1), 1);
});

test("Halberda task and Weber model validate as a compatible pair", () => {
  const task_result = validateTask(task);
  assert.deepEqual(task_result.problems.filter(p => p.level === "error"), []);

  const sample_design = task.design_grid[0];
  const model_result = validateModel(model, {
    sampleDesign: sample_design,
    sampleDraw: { w: 0.25 },
  });
  assert.deepEqual(model_result.problems.filter(p => p.level === "error"), []);
});
