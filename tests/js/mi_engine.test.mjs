import { test } from "node:test";
import assert from "node:assert/strict";

import {
  binaryEntropy,
  mutualInfo,
  realizedInformationGain,
  enumerateDesigns,
  selectOptimalDesign,
  summarizeDraws,
  samplePriorDraws,
} from "../../experiments/delay_discounting/ado/mi_engine.js";
import { createSeededRng } from "../../experiments/delay_discounting/dd_simulation.js";

const LN2 = Math.log(2);

test("binaryEntropy is 0 at the endpoints and ln2 at 0.5", () => {
  assert.equal(binaryEntropy(0), 0);
  assert.equal(binaryEntropy(1), 0);
  assert.equal(binaryEntropy(-0.5), 0);
  assert.equal(binaryEntropy(1.5), 0);
  assert.ok(Math.abs(binaryEntropy(0.5) - LN2) < 1e-12);
});

test("mutualInfo is ~0 when every draw answers a design the same way", () => {
  // choiceProbLL ignores the draw and returns a near-deterministic response.
  const draws = [{ x: 1 }, { x: 2 }, { x: 3 }];
  const mi = mutualInfo({}, draws, () => 0.999);
  assert.ok(mi < 1e-3, `expected ~0 MI, got ${mi}`);
});

test("mutualInfo is maximal (ln2) when draws split a design 50/50 deterministically", () => {
  // Half the draws say p=1, half say p=0 -> marginal 0.5, conditional entropy 0.
  const draws = [{ s: 0 }, { s: 1 }, { s: 0 }, { s: 1 }];
  const choiceProbLL = (_design, draw) => (draw.s === 1 ? 1 : 0);
  const mi = mutualInfo({}, draws, choiceProbLL);
  assert.ok(Math.abs(mi - LN2) < 1e-9, `expected ln2, got ${mi}`);
});

test("realizedInformationGain is ln2 for a deterministic split after either response", () => {
  const draws = [{ s: 0 }, { s: 1 }, { s: 0 }, { s: 1 }];
  const choiceProbLL = (_design, draw) => (draw.s === 1 ? 1 : 0);

  assert.ok(Math.abs(realizedInformationGain({}, draws, 1, choiceProbLL) - LN2) < 1e-9);
  assert.ok(Math.abs(realizedInformationGain({}, draws, 0, choiceProbLL) - LN2) < 1e-9);
});

test("expected realizedInformationGain matches mutualInfo for a binary response", () => {
  const draws = [{ p: 0.1 }, { p: 0.3 }, { p: 0.7 }, { p: 0.9 }];
  const choiceProbLL = (_design, draw) => draw.p;
  const mean_p = draws.reduce((sum, draw) => sum + draw.p, 0) / draws.length;
  const expected_gain =
    mean_p * realizedInformationGain({}, draws, 1, choiceProbLL) +
    (1 - mean_p) * realizedInformationGain({}, draws, 0, choiceProbLL);

  assert.ok(Math.abs(expected_gain - mutualInfo({}, draws, choiceProbLL)) < 1e-12);
});

test("enumerateDesigns produces the full cartesian product", () => {
  const grid = { a: [1, 2, 3], b: [10, 20] };
  const designs = enumerateDesigns(grid);
  assert.equal(designs.length, 6);
  assert.deepEqual(designs[0], { a: 1, b: 10 });
  // Every combination is present and well-formed.
  for (const d of designs) {
    assert.ok(grid.a.includes(d.a) && grid.b.includes(d.b));
  }
});

test("selectOptimalDesign returns a valid grid member and prefers the discriminating design", () => {
  const designs = enumerateDesigns({ d: [0, 1] });
  // Design d=0 is uninformative (all draws -> p=0.99); d=1 splits the draws.
  const draws = [{ s: 0 }, { s: 1 }, { s: 0 }, { s: 1 }];
  const choiceProbLL = (design, draw) => (design.d === 0 ? 0.99 : draw.s === 1 ? 1 : 0);
  const { design, mutual_info } = selectOptimalDesign(designs, draws, choiceProbLL);
  assert.deepEqual(design, { d: 1 });
  assert.ok(mutual_info > 0);
  assert.ok(designs.includes(design));
});

test("summarizeDraws computes correct mean and sample SD", () => {
  const draws = [{ k: 2 }, { k: 4 }, { k: 4 }, { k: 6 }]; // mean 4, sample sd ~1.632993
  const { post_mean, post_sd } = summarizeDraws(draws, ["k"]);
  assert.ok(Math.abs(post_mean.k - 4) < 1e-12);
  assert.ok(Math.abs(post_sd.k - Math.sqrt(8 / 3)) < 1e-9);
});

test("samplePriorDraws is seed-reproducible and respects lognormal positivity", () => {
  const prior = {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
  };
  const a = samplePriorDraws(prior, 500, createSeededRng(7));
  const b = samplePriorDraws(prior, 500, createSeededRng(7));
  assert.deepEqual(a, b, "same seed must produce identical draws");
  assert.equal(a.length, 500);
  for (const draw of a) {
    assert.ok(draw.k > 0 && draw.tau > 0, "lognormal draws must be positive");
  }
  // A different seed should differ.
  const c = samplePriorDraws(prior, 500, createSeededRng(8));
  assert.notDeepEqual(a, c);
});
