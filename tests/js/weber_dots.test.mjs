import { test } from "node:test";
import assert from "node:assert/strict";

import model, {
  choiceProbLL,
  normalCdf,
  numerosities,
  buildData,
} from "../../jspsych-ado/models/weber_dots/model.js";

test("normalCdf matches known Φ values and is well-behaved", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1) - 0.8413447) < 1e-4);
  assert.ok(Math.abs(normalCdf(2) - 0.9772499) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1) - (1 - 0.8413447)) < 1e-4); // symmetry
  assert.ok(normalCdf(8) <= 1 && normalCdf(-8) >= 0); // no overflow
});

test("choiceProbLL matches Phi((n_large-n_small)/(w*sqrt(nL^2+nS^2))) (regression guard)", () => {
  const design = { n_blue: 10, n_yellow: 20 };
  const w = 0.25;
  const { n_large, n_small } = numerosities(design);
  const expected = normalCdf((n_large - n_small) / (w * Math.sqrt(n_large * n_large + n_small * n_small)));
  const got = choiceProbLL(design, { w });
  assert.ok(got > 0.5 && got < 1);
  assert.ok(Math.abs(got - expected) < 1e-12, `expected ${expected}, got ${got}`);
});

test("colour-symmetric: P(correct) depends only on the numerosities, not which colour is larger", () => {
  const a = choiceProbLL({ n_blue: 20, n_yellow: 10 }, { w: 0.3 });
  const b = choiceProbLL({ n_blue: 10, n_yellow: 20 }, { w: 0.3 });
  assert.ok(Math.abs(a - b) < 1e-12);
});

test("P(correct) >= 0.5 and rises as the ratio gets easier", () => {
  const w = 0.25;
  const ps = [11, 13, 16, 20, 30].map((nl) => choiceProbLL({ n_blue: 10, n_yellow: nl }, { w }));
  for (const p of ps) assert.ok(p >= 0.5);
  for (let i = 1; i < ps.length; i++) {
    assert.ok(ps[i] > ps[i - 1], `P(correct) should rise with the ratio: ${ps}`);
  }
});

test("larger w (noisier acuity) lowers P(correct)", () => {
  const design = { n_blue: 10, n_yellow: 13 };
  const ps = [0.1, 0.25, 0.5, 1.0].map((w) => choiceProbLL(design, { w }));
  for (let i = 1; i < ps.length; i++) {
    assert.ok(ps[i] < ps[i - 1], `P(correct) should fall as w grows: ${ps}`);
  }
});

test("buildData maps accumulated trials to the Stan data block (correct = choice)", () => {
  const trials = [
    { n_blue: 10, n_yellow: 20, choice: 1 },
    { n_blue: 15, n_yellow: 10, choice: 0 },
  ];
  const data = buildData(trials);
  assert.equal(data.N, 2);
  assert.deepEqual(data.n_blue, [10, 15]);
  assert.deepEqual(data.n_yellow, [20, 10]);
  assert.deepEqual(data.correct, [1, 0]);
});

test("model adapter exposes the expected metadata", () => {
  assert.equal(model.id, "weber_dots");
  assert.deepEqual(model.params, ["w"]);
  assert.equal(model.prior.w.dist, "lognormal");
  assert.ok(Math.abs(model.prior.w.meanlog - Math.log(0.25)) < 1e-12);
  assert.ok(model.moduleUrl.endsWith("main.js"));
  assert.equal(typeof model.buildData, "function");
  assert.equal(typeof model.choiceProbLL, "function");
});
