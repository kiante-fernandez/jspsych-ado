import { test } from "node:test";
import assert from "node:assert/strict";

import model, {
  choiceProbLL,
  getHyperbolicValue,
  logistic,
  buildData,
} from "../../jspsych-ado/models/hyperbolic/model.js";

test("logistic basics", () => {
  assert.ok(Math.abs(logistic(0) - 0.5) < 1e-12);
  assert.ok(Math.abs(logistic(10) + logistic(-10) - 1) < 1e-9); // symmetry
  assert.ok(logistic(100) <= 1 && logistic(-100) >= 0); // no overflow
});

test("getHyperbolicValue matches V = R / (1 + k t)", () => {
  assert.ok(Math.abs(getHyperbolicValue(200, 10, 0.05) - 200 / 1.5) < 1e-12);
  assert.equal(getHyperbolicValue(400, 0, 0.3), 400); // no discount at delay 0
});

test("choiceProbLL matches the hyperbolic + logit formula (regression guard)", () => {
  const design = { t_ss: 0, t_ll: 10, r_ss: 100, r_ll: 200 };
  const params = { k: 0.05, tau: 0.05 };
  const v_ss = 100 / (1 + 0.05 * 0);
  const v_ll = 200 / (1 + 0.05 * 10);
  const expected = 1 / (1 + Math.exp(-params.tau * (v_ll - v_ss)));
  const got = choiceProbLL(design, params);
  assert.ok(got > 0 && got < 1);
  assert.ok(Math.abs(got - expected) < 1e-12, `expected ${expected}, got ${got}`);
});

test("changing k: more discounting (larger k) lowers P(LL) when LL is the delayed option", () => {
  const design = { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800 };
  // tau small enough that the logistic doesn't saturate, so the monotonic drop in
  // P(LL) as k grows across several orders of magnitude is actually visible.
  const ks = [0.0001, 0.001, 0.01, 0.1, 1];
  const probs = ks.map(k => choiceProbLL(design, { k, tau: 0.005 }));
  for (let i = 1; i < probs.length; i++) {
    assert.ok(probs[i] < probs[i - 1], `P(LL) should fall as k grows: k=${ks[i]} gave ${probs[i]} >= ${probs[i - 1]}`);
  }
});

test("changing tau: higher tau makes choices more deterministic (P(LL) -> 0/1)", () => {
  // Modest value gaps + small tau keep the logistic off its asymptotes so the
  // sharpening effect of tau is observable.
  // LL preferred (v_ll > v_ss): raising tau pushes P(LL) further above 0.5.
  const ll_pref = { t_ss: 0, t_ll: 52, r_ss: 500, r_ll: 800 };
  const ll_low = choiceProbLL(ll_pref, { k: 0.005, tau: 0.002 });
  const ll_high = choiceProbLL(ll_pref, { k: 0.005, tau: 0.01 });
  assert.ok(ll_high > ll_low && ll_low > 0.5, `LL-preferred: tau up should raise P(LL): ${ll_low} -> ${ll_high}`);

  // SS preferred (v_ss > v_ll): raising tau pushes P(LL) further below 0.5.
  const ss_pref = { t_ss: 0, t_ll: 52, r_ss: 700, r_ll: 800 };
  const ss_low = choiceProbLL(ss_pref, { k: 0.02, tau: 0.002 });
  const ss_high = choiceProbLL(ss_pref, { k: 0.02, tau: 0.01 });
  assert.ok(ss_high < ss_low && ss_low < 0.5, `SS-preferred: tau up should lower P(LL): ${ss_low} -> ${ss_high}`);
});

test("changing tau: tau -> 0 makes choices random (P(LL) -> 0.5)", () => {
  const design = { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800 };
  const p = choiceProbLL(design, { k: 0.01, tau: 1e-6 });
  assert.ok(Math.abs(p - 0.5) < 1e-3, `near-zero tau should give ~0.5, got ${p}`);
});

test("buildData maps accumulated trials to the Stan data block (y = choice)", () => {
  const trials = [
    { t_ss: 0, t_ll: 4.3, r_ss: 100, r_ll: 800, choice: 1 },
    { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800, choice: 0 },
  ];
  const data = buildData(trials);
  assert.equal(data.N, 2);
  assert.deepEqual(data.t_ss, [0, 0]);
  assert.deepEqual(data.t_ll, [4.3, 52]);
  assert.deepEqual(data.r_ss, [100, 400]);
  assert.deepEqual(data.r_ll, [800, 800]);
  assert.deepEqual(data.y, [1, 0]);
});

test("model adapter exposes the expected metadata", () => {
  assert.equal(model.id, "hyperbolic");
  assert.deepEqual(model.params, ["k", "tau"]);
  assert.equal(model.prior.k.dist, "lognormal");
  assert.equal(model.prior.tau.dist, "lognormal");
  assert.ok(model.moduleUrl.endsWith("main.js"));
  assert.equal(typeof model.buildData, "function");
  assert.equal(typeof model.choiceProbLL, "function");
});

test("model adapter exposes the presentation/choice contract", () => {
  assert.equal(typeof model.presentation.makeStimulus, "function");
  assert.equal(typeof model.presentation.button_html, "function");
  assert.deepEqual(model.presentation.keymap, { s: 0, l: 1 });
  assert.deepEqual(model.choices, ["SS", "LL"]);
  assert.deepEqual(model.response_labels, { 0: "SS", 1: "LL" });

  const design = { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800 };
  const cards = model.presentation.button_html(design);
  assert.equal(cards.length, 2);
  assert.ok(cards[0].includes("$400") && cards[1].includes("$800"));
  // describeDesign feeds the debug log with task-specific offer lines.
  const lines = model.presentation.describeDesign(design);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("SS:") && lines[1].startsWith("LL:"));
});
