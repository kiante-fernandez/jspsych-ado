// Scaffolding shared by the stan and mock controllers, kept here so the two stay
// contract-identical: both emit the same null-metric shape for non-MI designs and walk
// the same testlet/stopping budget.

/**
 * Per-design "no mutual information available" metrics, for designs chosen without an MI
 * scan (the mock controller, and the Stan controller's random-design baseline).
 *
 * @param {number} count - Number of designs in the testlet.
 * @returns {Array<{mutual_info: null}>} An array of length `count`.
 */
function nullDesignMetrics(count) {
  const metrics = [];
  for (let i = 0; i < count; i++) {
    metrics.push({ mutual_info: null });
  }
  return metrics;
}

/**
 * Build the "how many designs does the next testlet need" function for a controller.
 *
 * The effective trial cap is the stopping max_trials (which already falls back to
 * n_trials), so the controller supplies a design for every node the timeline can run —
 * `stopping: { max_trials > n_trials }` no longer underflows.
 *
 * @param {Object} stopper - A makeStoppingEvaluator() result (reads stopper.config.max_trials).
 * @param {number} testlet_size - Choice trials shown between refits.
 * @returns {(from_index: number) => number} nextBlockSize(from_index).
 */
function makeBlockSizer(stopper, testlet_size) {
  return function nextBlockSize(from_index) {
    const cap = stopper.config.max_trials;
    const remaining = cap == null ? testlet_size : Math.max(0, cap - from_index);
    return Math.min(testlet_size, remaining);
  };
}

export { nullDesignMetrics, makeBlockSizer };
