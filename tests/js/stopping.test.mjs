import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStoppingConfig,
  evaluateStopping,
  maxPossibleEig,
  makeStoppingEvaluator,
} from "../../src/ado/stopping.js";

const LN2 = Math.log(2);
const LN3 = Math.log(3);

// Convenience: evaluate one refit against a fresh-normalized config.
function evalAt(
  completed,
  eig,
  { max_possible_eig = LN2, consecutive_below = 0, ...stopping } = {},
) {
  return evaluateStopping({
    completed_trials: completed,
    eig,
    max_possible_eig,
    consecutive_below,
    stopping: normalizeStoppingConfig(stopping),
  });
}

test("normalizeStoppingConfig fills defaults and the max_trials fallback", () => {
  assert.deepEqual(normalizeStoppingConfig({}, 42), {
    min_trials: 0,
    max_trials: 42,
    eig_fraction: null,
    consecutive: 1,
  });
  assert.deepEqual(
    normalizeStoppingConfig({ min_trials: 8, max_trials: 30, eig_fraction: 0.1, consecutive: 2 }),
    { min_trials: 8, max_trials: 30, eig_fraction: 0.1, consecutive: 2 },
  );
});

test("normalizeStoppingConfig rejects junk and turns EIG stopping off for non-positive fraction", () => {
  const n = normalizeStoppingConfig(
    { min_trials: -3, max_trials: "x", eig_fraction: 0, consecutive: 0 },
    null,
  );
  assert.equal(n.min_trials, 0);
  assert.equal(n.max_trials, null);
  assert.equal(n.eig_fraction, null); // 0 => off
  assert.equal(n.consecutive, 1);
});

test("normalizeStoppingConfig keeps eig_fraction == 1 but turns it off for > 1 (#4)", () => {
  // A fraction > 1 sets a threshold above the max achievable EIG (ln K), i.e.
  // "always stop at min_trials" — a footgun, so it must disable EIG stopping.
  assert.equal(normalizeStoppingConfig({ eig_fraction: 1 }).eig_fraction, 1);
  assert.equal(normalizeStoppingConfig({ eig_fraction: 1.5 }).eig_fraction, null);
  assert.equal(normalizeStoppingConfig({ eig_fraction: 2 }).eig_fraction, null);
});

test("maxPossibleEig = ln(K)", () => {
  assert.equal(maxPossibleEig({ type: "binary" }), LN2);
  assert.equal(maxPossibleEig({ type: "categorical", n_categories: 3 }), LN3);
  assert.equal(maxPossibleEig({ type: "categorical", n_categories: 1 }), null);
  assert.equal(maxPossibleEig(null), null);
});

test("never stops before min_trials, even with tiny EIG", () => {
  const r = evalAt(5, 0.0001, { min_trials: 8, max_trials: 42, eig_fraction: 0.1 });
  assert.equal(r.should_stop, false);
  assert.equal(r.consecutive_below, 0); // below the min gate => streak stays 0
});

test("always stops at max_trials regardless of EIG (max takes precedence)", () => {
  const r = evalAt(42, 0.6, { min_trials: 8, max_trials: 42, eig_fraction: 0.1 });
  assert.equal(r.should_stop, true);
  assert.equal(r.stop_reason, "max_trials");
});

test("eig stop fires when grid-max EIG < fraction*ln(K), past min_trials", () => {
  // threshold = 0.1 * ln2 ≈ 0.0693
  const below = evalAt(10, 0.05, { min_trials: 8, max_trials: 42, eig_fraction: 0.1 });
  assert.equal(below.should_stop, true);
  assert.equal(below.stop_reason, "eig_fraction");

  const above = evalAt(10, 0.2, { min_trials: 8, max_trials: 42, eig_fraction: 0.1 });
  assert.equal(above.should_stop, false);
});

test("threshold is a fraction of max EIG, so it scales with response cardinality", () => {
  // eig = 0.09: below 0.1*ln3 (=0.1099) for a 3-category task, but not below 0.1*ln2 (=0.0693) for binary.
  const cat = evalAt(10, 0.09, {
    min_trials: 8,
    max_trials: 42,
    eig_fraction: 0.1,
    max_possible_eig: LN3,
  });
  assert.equal(cat.should_stop, true);
  assert.equal(cat.stop_reason, "eig_fraction");

  const bin = evalAt(10, 0.09, {
    min_trials: 8,
    max_trials: 42,
    eig_fraction: 0.1,
    max_possible_eig: LN2,
  });
  assert.equal(bin.should_stop, false);
});

test("eig_fraction null => EIG stopping off, only the max cap applies", () => {
  assert.equal(evalAt(10, 0.0, { max_trials: 42 }).should_stop, false);
  assert.equal(evalAt(42, 0.0, { max_trials: 42 }).stop_reason, "max_trials");
});

test("null EIG never triggers an eig stop", () => {
  const r = evalAt(10, null, { min_trials: 8, max_trials: 42, eig_fraction: 0.1 });
  assert.equal(r.should_stop, false);
});

test("de-bounce: consecutive=2 needs two sub-threshold refits in a row; a rebound resets the streak", () => {
  const cfg = normalizeStoppingConfig({
    min_trials: 8,
    max_trials: 42,
    eig_fraction: 0.1,
    consecutive: 2,
  });
  // first sub-threshold refit: streak -> 1, no stop yet
  const r1 = evaluateStopping({
    completed_trials: 10,
    eig: 0.05,
    max_possible_eig: LN2,
    consecutive_below: 0,
    stopping: cfg,
  });
  assert.equal(r1.should_stop, false);
  assert.equal(r1.consecutive_below, 1);
  // EIG rebounds above threshold: streak resets
  const r2 = evaluateStopping({
    completed_trials: 11,
    eig: 0.2,
    max_possible_eig: LN2,
    consecutive_below: r1.consecutive_below,
    stopping: cfg,
  });
  assert.equal(r2.should_stop, false);
  assert.equal(r2.consecutive_below, 0);
  // two sub-threshold refits in a row -> stop
  const r3 = evaluateStopping({
    completed_trials: 12,
    eig: 0.04,
    max_possible_eig: LN2,
    consecutive_below: 0,
    stopping: cfg,
  });
  const r4 = evaluateStopping({
    completed_trials: 13,
    eig: 0.03,
    max_possible_eig: LN2,
    consecutive_below: r3.consecutive_below,
    stopping: cfg,
  });
  assert.equal(r3.should_stop, false);
  assert.equal(r4.should_stop, true);
  assert.equal(r4.stop_reason, "eig_fraction");
});

test("makeStoppingEvaluator threads the consecutive-below streak and reset() clears it", () => {
  const stopper = makeStoppingEvaluator({
    stopping: { min_trials: 1, max_trials: 50, eig_fraction: 0.1, consecutive: 2 },
    default_max_trials: 50,
    max_possible_eig: LN2, // threshold = 0.0693
  });
  assert.equal(stopper.config.max_trials, 50);
  // first sub-threshold refit: streak 1, no stop; second in a row: stop.
  assert.deepEqual(stopper.evaluate(5, 0.04), { should_stop: false, stop_reason: null });
  assert.deepEqual(stopper.evaluate(6, 0.03), { should_stop: true, stop_reason: "eig_fraction" });
  // reset clears the streak, so a single sub-threshold refit no longer stops.
  stopper.reset();
  assert.deepEqual(stopper.evaluate(7, 0.03), { should_stop: false, stop_reason: null });
});

test("makeStoppingEvaluator with no max_possible_eig (mock) only ever max_trials-stops", () => {
  const stopper = makeStoppingEvaluator({
    stopping: { eig_fraction: 0.1, max_trials: 3 },
    default_max_trials: 3,
  });
  assert.deepEqual(stopper.evaluate(2, null), { should_stop: false, stop_reason: null });
  assert.deepEqual(stopper.evaluate(3, null), { should_stop: true, stop_reason: "max_trials" });
});

test("a higher eig_fraction stops earlier on the same decreasing EIG trajectory", () => {
  // EIG decays from 0.5 down; find first stop trial for two fractions (min_trials small).
  const trajectory = [0.5, 0.4, 0.3, 0.2, 0.12, 0.08, 0.05, 0.03, 0.02];
  function firstStop(fraction) {
    const cfg = normalizeStoppingConfig({ min_trials: 1, max_trials: 100, eig_fraction: fraction });
    let streak = 0;
    for (let i = 0; i < trajectory.length; i++) {
      const r = evaluateStopping({
        completed_trials: i + 1,
        eig: trajectory[i],
        max_possible_eig: LN2,
        consecutive_below: streak,
        stopping: cfg,
      });
      streak = r.consecutive_below;
      if (r.should_stop) return i + 1;
    }
    return null;
  }
  const lenient = firstStop(0.1); // threshold 0.0693
  const strict = firstStop(0.3); // threshold 0.2079 -> crosses sooner
  assert.ok(
    strict < lenient,
    `stricter (higher) fraction should stop earlier: strict=${strict} lenient=${lenient}`,
  );
});
