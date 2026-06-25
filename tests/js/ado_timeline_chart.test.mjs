import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getParamAxisDomain,
  makeParamConvergenceSvg,
} from "../../src/ado/debug/posterior_convergence_charts.js";

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

test("getParamAxisDomain uses the mean ± SD envelope plus 15% padding", () => {
  const axis = getParamAxisDomain(
    [
      { trial: 1, mean: 1, sd: 0.2 },
      { trial: 2, mean: 2, sd: 0.3 },
    ],
    {},
  );

  assertClose(axis.y_min, 0.575);
  assertClose(axis.y_max, 2.525);
  assert.equal(axis.axis_expanded, false);
});

test("getParamAxisDomain enforces min_y_span for tightly clustered data", () => {
  const axis = getParamAxisDomain(
    [
      { trial: 1, mean: 1, sd: 0 },
      { trial: 2, mean: 1.01, sd: 0 },
    ],
    { min_y_span: 0.5 },
  );

  assertClose(axis.y_min, 0.755);
  assertClose(axis.y_max, 1.255);
});

test("getParamAxisDomain treats y_min and y_max as preferred ranges, not clamps", () => {
  const axis = getParamAxisDomain(
    [
      { trial: 1, mean: 10, sd: 0.5 },
      { trial: 2, mean: 11, sd: 0.5 },
    ],
    { y_min: 0, y_max: 7 },
  );

  assert.ok(axis.y_min > 7);
  assert.ok(axis.y_max > 7);
  assert.equal(axis.axis_expanded, true);
});

test("getParamAxisDomain does not clip a degenerate point outside the preferred range", () => {
  const axis = getParamAxisDomain([{ trial: 1, mean: 10, sd: 0 }], { y_min: 0, y_max: 7 });

  assert.ok(axis.y_min < 10);
  assert.ok(axis.y_max > 10);
  assert.equal(axis.axis_expanded, true);
});

test("getParamAxisDomain applies lower_bound for constrained parameters", () => {
  const axis = getParamAxisDomain([{ trial: 1, mean: 0.01, sd: 0.05 }], { lower_bound: 0 });

  assert.equal(axis.y_min, 0);
  assert.ok(axis.y_max > 0);
  assert.equal(axis.axis_lower_bounded, true);
});

test("getParamAxisDomain respects upper_bound after fallback and min-span logic", () => {
  const axis = getParamAxisDomain([{ trial: 1, mean: 10, sd: 0 }], {
    y_min: 0,
    y_max: 7,
    lower_bound: 0,
    upper_bound: 7,
    min_y_span: 0.5,
  });

  assert.equal(axis.y_max, 7);
  assert.ok(axis.y_min < axis.y_max);
  assert.equal(axis.axis_upper_bounded, true);
});

test("getParamAxisDomain lets unbounded bias parameters expand past preferred ranges", () => {
  const axis = getParamAxisDomain([{ trial: 1, mean: 1.8, sd: 0.1 }], { y_min: -1.5, y_max: 1.5 });

  assert.ok(axis.y_max > 1.5);
  assert.equal(axis.axis_expanded, true);
  assert.equal(axis.axis_upper_bounded, false);
});

test("makeParamConvergenceSvg reports axis expansion and true bounds", () => {
  const expanded = makeParamConvergenceSvg([{ trial: 1, mean: 1.8, sd: 0.1 }], "bias_b", {
    y_min: -1.5,
    y_max: 1.5,
  });
  const bounded = makeParamConvergenceSvg([{ trial: 1, mean: -0.1, sd: 0.1 }], "k", {
    lower_bound: 0,
  });

  assert.match(expanded, /axis expanded/);
  assert.match(bounded, /lower bound/);
});
