// Design-selection metric helpers used on the timeline's data path (always on, not
// debug-gated): they normalize the controller's per-design metrics into a stable shape
// and align them with the returned designs. Kept out of debug/ so the production data
// boundary doesn't depend on the debug-logging module.

/**
 * Normalize a per-design metric to a stable shape: always an object with a numeric-or-null
 * `mutual_info` (non-finite or missing -> null), preserving any other fields.
 *
 * @param {?Object} metric - A raw selection metric (e.g. { mutual_info }).
 * @returns {Object} { mutual_info: number|null, ... }.
 */
function normalizeDesignMetric(metric) {
  if (!metric || typeof metric !== "object") {
    return { mutual_info: null };
  }
  const mutual_info = metric.mutual_info;
  return {
    ...metric,
    mutual_info:
      typeof mutual_info === "number" && Number.isFinite(mutual_info) ? mutual_info : null,
  };
}

/**
 * Build a normalized metric array aligned 1:1 with the `design_count` returned designs,
 * padding with null-metric entries when the controller supplied fewer (or no) metrics.
 *
 * @param {Object} result - Controller start()/update() result (reads next_design_metrics).
 * @param {number} design_count - Number of designs to align metrics to.
 * @returns {Object[]} Exactly `design_count` normalized metric objects.
 */
function metricsFromResult(result, design_count) {
  const metrics = Array.isArray(result.next_design_metrics) ? result.next_design_metrics : [];
  const normalized = [];
  for (let i = 0; i < design_count; i++) {
    normalized.push(normalizeDesignMetric(metrics[i]));
  }
  return normalized;
}

export { normalizeDesignMetric, metricsFromResult };
