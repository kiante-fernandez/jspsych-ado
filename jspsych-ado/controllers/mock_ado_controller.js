// Model-agnostic mock ADO controller. Satisfies the same start/update contract as
// the in-browser Stan controller, but without WASM — for fast timeline/UI work and
// browser smoke tests. It knows nothing about any specific task: designs are drawn
// from the candidate grid via the generic engine, and mock posteriors are emitted
// for whatever parameter names the model declares. Selection diagnostics are
// reported as null so mock runs never imply real information-gain estimates.

import { enumerateDesigns } from "../ado/mi_engine.js";
import { makeStoppingEvaluator } from "../ado/stopping.js";

/**
 * Create a deterministic local controller for any registered model.
 *
 * @param {Object} options
 * @param {Object|Array} options.grid_design - Candidate design grid (object of value
 *   arrays, or a curated array of designs) — same shape the Stan controller takes.
 * @param {string[]} [options.params] - Parameter names to emit mock posteriors for
 *   (e.g. ["k", "tau"]); defaults to none.
 * @param {number} [options.n_trials] - Total number of choice trials.
 * @param {number} [options.testlet_size=1] - Choice trials shown between updates.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createMockAdoController({ grid_design, params = [], n_trials = null, testlet_size = 1, stopping = null } = {}) {
  const designs = enumerateDesigns(grid_design);
  if (designs.length === 0) {
    throw new Error("createMockAdoController: grid_design produced no candidate designs.");
  }
  if (!Number.isInteger(testlet_size) || testlet_size < 1) {
    throw new Error("createMockAdoController: testlet_size must be a positive integer");
  }

  // Mock has no real EIG, so EIG stopping is inert (no max_possible_eig); only the
  // max_trials cap applies. should_stop/stop_reason are still emitted for contract
  // parity, so the timeline's stopping loop behaves identically.
  const stopper = makeStoppingEvaluator({ stopping, default_max_trials: n_trials });

  let session_id = "mock-session";
  let trial_index = 0;

  // Walk the candidate designs deterministically so successive trials differ.
  function mockDesign(index) {
    return designs[(index * 7) % designs.length];
  }

  function nextBlockSize(from_index) {
    // Effective trial cap = stopping max_trials (falls back to n_trials), so the
    // mock supplies designs for every node the timeline can run.
    const cap = stopper.config.max_trials;
    const remaining = cap == null ? testlet_size : Math.max(0, cap - from_index);
    return Math.min(testlet_size, remaining);
  }

  function mockDesigns(from_index) {
    const count = nextBlockSize(from_index);
    const next_designs = [];
    for (let i = 0; i < count; i++) {
      next_designs.push(mockDesign(from_index + i));
    }
    return next_designs;
  }

  function nullDesignMetrics(count) {
    const metrics = [];
    for (let i = 0; i < count; i++) {
      metrics.push({ mutual_info: null });
    }
    return metrics;
  }

  // Deterministic per-parameter summaries that drift with the trial index, so the
  // live posterior charts have something monotone-ish to render.
  function mockPosterior(index) {
    const post_mean = {};
    const post_sd = {};
    params.forEach((param, p) => {
      post_mean[param] = 0.05 + index * 0.002 * (p + 1);
      post_sd[param] = Math.max(0.001, 0.05 - index * 0.001);
    });
    return { post_mean, post_sd };
  }

  return {
    /**
     * Start a mock ADO session and return the first deterministic design.
     *
     * @param {Object} context - Run context; session_id is used if present.
     * @returns {Promise<Object>} ADO state with next_design and null posteriors.
     */
    start: async function(context) {
      session_id = (context && context.session_id) || "mock-session";
      trial_index = 0;
      const next_designs = mockDesigns(trial_index);
      return {
        session_id,
        trial_index,
        next_design: next_designs[0] ?? null,
        next_designs,
        next_design_metrics: nullDesignMetrics(next_designs.length),
        selection_time_ms: null,
        max_mutual_info: null,
        ...stopper.evaluate(trial_index, null),
        post_mean: null,
        post_sd: null,
        api_latency_ms: null,
      };
    },

    /**
     * Advance the mock controller after one completed jsPsych choice row/testlet.
     *
     * @param {Object|Array<Object>} trial_data - Choice row(s) with ado_trial_index.
     * @returns {Promise<Object>} Updated mock ADO state.
     */
    update: async function(trial_data) {
      const rows = Array.isArray(trial_data) ? trial_data : [trial_data];
      trial_index += rows.length;
      const { post_mean, post_sd } = mockPosterior(trial_index);
      const next_designs = mockDesigns(trial_index);
      return {
        session_id,
        trial_index,
        next_design: next_designs[0] ?? null,
        next_designs,
        next_design_metrics: nullDesignMetrics(next_designs.length),
        selection_time_ms: null,
        max_mutual_info: null,
        ...stopper.evaluate(trial_index, null),
        post_mean,
        post_sd,
        api_latency_ms: null,
      };
    }
  };
}

export { createMockAdoController };
