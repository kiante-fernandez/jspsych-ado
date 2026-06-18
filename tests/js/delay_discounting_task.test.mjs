import { test } from "node:test";
import assert from "node:assert/strict";

import task from "../../jspsych-ado/tasks/delay_discounting/task.js";
import { enumerateDesigns } from "../../jspsych-ado/ado/mi_engine.js";

test("delay-discounting task exposes the presentation and response contract", () => {
  assert.equal(task.id, "delay_discounting");
  assert.deepEqual(task.designKeys, ["t_ss", "t_ll", "r_ss", "r_ll"]);
  assert.deepEqual(task.responseSpace, { type: "binary" });
  assert.deepEqual(task.choices, ["SS", "LL"]);
  assert.deepEqual(task.response_labels, { 0: "SS", 1: "LL" });
  assert.equal(typeof task.presentation.makeStimulus, "function");
  assert.equal(typeof task.presentation.button_html, "function");
  assert.deepEqual(task.presentation.keymap, { s: 0, l: 1 });
});

test("delay-discounting task grid produces SS/LL design fields", () => {
  const designs = enumerateDesigns(task.design_grid);
  assert.ok(designs.length > 0);
  for (const key of task.designKeys) {
    assert.ok(key in designs[0], `${key} should be present in the enumerated design`);
  }
});

test("delay-discounting task presentation renders option cards and debug labels", () => {
  const design = { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800 };
  const stimulus = task.presentation.makeStimulus(design);
  const cards = task.presentation.button_html(design);
  const lines = task.presentation.describeDesign(design);

  assert.ok(stimulus.includes("Which would you prefer?"));
  assert.equal(cards.length, 2);
  assert.ok(cards[0].includes("$400") && cards[1].includes("$800"));
  assert.ok(cards[0].includes(">S<") && cards[1].includes(">L<"));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("SS:") && lines[1].startsWith("LL:"));
});
