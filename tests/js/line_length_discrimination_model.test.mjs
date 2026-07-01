import { test } from "node:test";
import assert from "node:assert/strict";

import {
  default as model,
  responseProbs,
} from "../../src/models/line_length_discrimination_3ifc/model.js";
import { makeStanDataBuilder } from "../../src/ado/stan_data.js";

// Local copy of the demo's design helper (task code is experiment-owned under the
// controller API; the model's likelihood only needs the design fields).
const LINE_LABELS = ["A", "B", "C"];
function make3IFCDesign(standard_length, delta, target_index) {
  const design = {
    standard_length,
    delta,
    target_index,
    target_label: LINE_LABELS[target_index],
  };
  ["len_a", "len_b", "len_c"].forEach((key, i) => {
    design[key] = standard_length + (i === target_index ? delta : 0);
  });
  return design;
}

// The model declares a stanData map; the framework generates buildData from it.
const buildData = makeStanDataBuilder({
  stanData: model.stanData,
  responseSpace: model.responseSpace,
});

const params = {
  sensitivity: 2.2,
  bias_b: 0,
  bias_c: 0,
};

function assertProbabilityVector(probs) {
  assert.equal(probs.length, 3);
  for (const p of probs) {
    assert.equal(Number.isFinite(p), true);
    assert.ok(p >= 0);
    assert.ok(p <= 1);
  }
  const total = probs.reduce((sum, p) => sum + p, 0);
  assert.ok(Math.abs(total - 1) < 1e-12, `probabilities should sum to 1, got ${total}`);
}

test("responseProbs returns a valid 3-category probability vector", () => {
  assertProbabilityVector(responseProbs(make3IFCDesign(200, 16, 0), params));
});

test("responseProbs favors the target line and strengthens with larger delta", () => {
  const target_a_small = responseProbs(make3IFCDesign(200, 8, 0), params);
  const target_a_large = responseProbs(make3IFCDesign(200, 40, 0), params);
  const target_b = responseProbs(make3IFCDesign(200, 40, 1), params);
  const target_c = responseProbs(make3IFCDesign(200, 40, 2), params);

  assertProbabilityVector(target_a_small);
  assertProbabilityVector(target_a_large);
  assertProbabilityVector(target_b);
  assertProbabilityVector(target_c);

  assert.ok(target_a_small[0] > target_a_small[1], "target A should be preferred over B");
  assert.ok(target_a_small[0] > target_a_small[2], "target A should be preferred over C");
  assert.ok(
    target_a_large[0] > target_a_small[0],
    "larger delta should increase target choice probability",
  );
  assert.ok(target_b[1] > target_b[0], "target B should be preferred over A");
  assert.ok(target_c[2] > target_c[0], "target C should be preferred over A");
});

test("responseProbs includes response-position bias terms", () => {
  const unbiased = responseProbs(make3IFCDesign(200, 0, 0), params);
  const biased = responseProbs(make3IFCDesign(200, 0, 0), {
    sensitivity: 2.2,
    bias_b: 1,
    bias_c: 0,
  });

  assertProbabilityVector(unbiased);
  assertProbabilityVector(biased);
  assert.ok(Math.abs(unbiased[0] - 1 / 3) < 1e-12);
  assert.ok(biased[1] > biased[0], "positive B bias should increase P(B)");
});

test("generated buildData maps jsPsych 0/1/2 choices and targets to Stan 1/2/3 categories", () => {
  const data = buildData([
    { delta: 8, target_index: 0, choice: 0 },
    { delta: 16, target_index: 1, choice: 2 },
    { delta: 24, target_index: 2, choice: 1 },
  ]);

  assert.deepEqual(data, {
    N: 3,
    delta: [8, 16, 24],
    target_index: [1, 2, 3],
    y: [1, 3, 2],
  });
});

test("model package exposes the categorical ADO contract", () => {
  assert.equal(model.id, "line_length_discrimination_3ifc");
  assert.equal(typeof model.moduleUrl, "string");
  assert.deepEqual(model.params, ["sensitivity", "bias_b", "bias_c"]);
  assert.deepEqual(model.responseSpace, { type: "categorical", n_categories: 3 });
  assert.equal(typeof model.responseProbs, "function");
  assert.equal(typeof model.stanData, "object");
  assert.deepEqual(model.stanData.target_index, { from: "target_index", index1: true });
  assert.equal(model.responseProb, undefined);
});
