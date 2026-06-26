import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildHistogram,
  inferPosteriorParams,
  formatPosteriorDrawCharts,
} from "../../src/ado/debug/posterior_debug_charts.js";

test("buildHistogram preserves the number of finite values", () => {
  const histogram = buildHistogram([1, 2, 2, 4, Number.NaN], 4);
  assert.equal(histogram.n, 4);
  assert.equal(
    histogram.counts.reduce((sum, count) => sum + count, 0),
    4,
  );
  assert.equal(histogram.min, 1);
  assert.equal(histogram.max, 4);
});

test("inferPosteriorParams keeps first-seen finite draw parameter order", () => {
  const draws = [
    { beta: 1, alpha: Number.NaN },
    { alpha: 2, gamma: 3 },
  ];

  assert.deepEqual(inferPosteriorParams(draws), ["beta", "alpha", "gamma"]);
});

test("formatPosteriorDrawCharts uses model display metadata for histogram scales", () => {
  const draws = [
    { k: 0.001, tau: 0.5, alpha: -1 },
    { k: 0.0011, tau: 0.55, alpha: -0.8 },
    { k: 0.002, tau: 1.0, alpha: 0 },
    { k: 0.004, tau: 1.5, alpha: 1 },
    { k: 0.008, tau: 2.0, alpha: 2 },
  ];
  const posterior_display = {
    k: { label: "k", histogram_scale: "log10", histogram_label: "log10(k)" },
    tau: { label: "τ" },
  };

  const output = formatPosteriorDrawCharts(draws, ["k", "tau", "alpha"], posterior_display, {
    bins: 4,
    height: 3,
  });

  assert.match(output, /Posterior draw histograms \(asciichart\):/);
  assert.match(output, /k \(log10\(k\); n=5\)/);
  assert.match(output, /tau \(τ; n=5\)/);
  assert.match(output, /alpha \(alpha; n=5\)/);
  assert.match(output, /x range: log10\(k\)/);
  assert.match(output, /─/u);
  assert.match(output, /[│╭╮╰╯]/u);
  assert.doesNotMatch(output, /\*|# /);
});

test("formatPosteriorDrawCharts infers parameter names when no list is provided", () => {
  const output = formatPosteriorDrawCharts(
    [
      { drift: 0.1, threshold: 1.0 },
      { drift: 0.2, threshold: 1.2 },
    ],
    null,
    null,
    { bins: 4, height: 3 },
  );

  assert.match(output, /drift \(drift; n=2\)/);
  assert.match(output, /threshold \(threshold; n=2\)/);
});
