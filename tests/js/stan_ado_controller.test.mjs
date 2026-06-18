import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateStoppingState,
  normalizeStoppingConfig,
} from "../../experiments/delay_discounting/controllers/stan_ado_controller.js";

test("normalizeStoppingConfig uses eig_tolerance and legacy n_trials fallback", () => {
  assert.deepEqual(
    normalizeStoppingConfig({ min_trials: 8, eig_tolerance: 0.05 }, 42),
    {
      min_trials: 8,
      max_trials: 42,
      eig_tolerance: 0.05,
    },
  );
});

test("EIG criterion stops after min_trials when eig is below tolerance", () => {
  const state = evaluateStoppingState({
    completed_trials: 8,
    eig: 0.049,
    stopping: {
      min_trials: 8,
      max_trials: 42,
      eig_tolerance: 0.05,
    },
  });

  assert.equal(state.should_stop, true);
  assert.equal(state.stop_reason, "eig_tolerance");
  assert.equal(state.eig, 0.049);
});

test("EIG criterion does not stop before min_trials or at equality", () => {
  const before_min = evaluateStoppingState({
    completed_trials: 7,
    eig: 0.01,
    stopping: {
      min_trials: 8,
      max_trials: 42,
      eig_tolerance: 0.05,
    },
  });
  const at_tolerance = evaluateStoppingState({
    completed_trials: 8,
    eig: 0.05,
    stopping: {
      min_trials: 8,
      max_trials: 42,
      eig_tolerance: 0.05,
    },
  });

  assert.equal(before_min.should_stop, false);
  assert.equal(at_tolerance.should_stop, false);
});

test("max_trials cap stops even when eig remains high", () => {
  const state = evaluateStoppingState({
    completed_trials: 42,
    eig: 0.5,
    stopping: {
      min_trials: 8,
      max_trials: 42,
      eig_tolerance: 0.05,
    },
  });

  assert.equal(state.should_stop, true);
  assert.equal(state.stop_reason, "max_trials");
});
