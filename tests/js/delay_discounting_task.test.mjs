import { test } from "node:test";
import assert from "node:assert/strict";

import {
  design_grid,
  describeDesign,
  makeButtonHtml,
  makeChoices,
  response_labels,
} from "../../demos/delay_discounting/task.js";
import { enumerateDesigns } from "../../jspsych-ado/ado/mi_engine.js";

test("delay-discounting helper exposes the pieces consumed by the showcase page", () => {
  assert.deepEqual(response_labels, { 0: "SS", 1: "LL" });
  assert.equal(typeof makeButtonHtml, "function");
  assert.equal(typeof makeChoices, "function");
});

test("delay-discounting demo grid produces SS/LL design fields", () => {
  const designs = enumerateDesigns(design_grid);
  assert.ok(designs.length > 0);
  for (const key of ["t_ss", "t_ll", "r_ss", "r_ll"]) {
    assert.ok(key in designs[0], `${key} should be present in the enumerated design`);
  }
});

test("delay-discounting demo helper renders option cards and debug labels", () => {
  const design = { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800 };
  const choices_html = makeChoices(design);
  const card = makeButtonHtml(choices_html[0]);
  const lines = describeDesign(design);

  assert.equal(choices_html.length, 2);
  assert.ok(choices_html[0].includes("$400") && choices_html[1].includes("$800"));
  assert.ok(choices_html[0].includes(">S<") && choices_html[1].includes(">L<"));
  assert.ok(card.startsWith("<button"));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("SS:") && lines[1].startsWith("LL:"));
});
