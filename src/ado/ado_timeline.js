import { normalizeStoppingConfig } from "./stopping.js";
import { normalizeDesignMetric, metricsFromResult } from "./design_metrics.js";
import { logAdoTrial } from "./debug/ado_trial_log.js";
import {
  updateLiveCharts,
  appendPosteriorHistory,
  appendInformationGainHistory,
  updateInformationGainPanel,
  finalizeDebugUi,
} from "./debug/posterior_convergence_charts.js";

// Generic adaptive-design-optimization (ADO) jsPsych timeline.
//
// This module is MODEL- AND STIMULUS-AGNOSTIC. It knows nothing about delay
// discounting, dots, or any particular task. It wires together:
//   - an ADO controller (sync start / async update; mock or in-browser Stan), and
//   - a trial factory that supplies ordinary, user-authored jsPsych trials,
// into the standard ADO loop: pick a design -> show it -> record the response ->
// re-infer + pick the next design. Everything experiment-specific (how a design
// is rendered, which raw response maps to which model outcome) lives in the
// user's trial code, so adding a model or task never requires editing this file.
//
// Scheduling contract (jsPsych >= 8): the response trial's on_finish is composed
// with the controller update and AWAITED by jsPsych, so the next adaptive trial
// cannot render until the next design is ready. There are no injected plugin
// trials (no call-function nodes) — the user's trials are the only trials.
//
// Design-advance timing: jsPsych 8 resolves function-valued trial parameters
// (processParameters) BEFORE on_start fires, so the current design must already
// be correct when the previous trial's on_finish resolves. The queue therefore
// advances at the END of each adaptive step — from the controller result at
// testlet boundaries, from the prefetched queue inside a testlet — and never in
// on_start (which only asserts the queue didn't underflow).
//
// The trial-factory contract (threaded through config):
//   - getChoiceTrials(ctx) -> Array<jsPsychTrial>
//       Return the jsPsych trials shown for one adaptive step. Exactly one of
//       them must be marked __ado_is_response by the controller facade, whose
//       composed on_finish stores the validated response on data.__ado_response.
//       ctx exposes: { getDesign(), getState(), choices, response_labels,
//       run_context, trial_number }
//   - describeDesign(design) -> string[] (optional): human-readable lines for
//       the debug log; defaults to generic key=value pairs.
//
// config: { n_trials, testlet_size?, stopping?, response_labels, choices,
//           getChoiceTrials, describeDesign? }.

// ---------------------------------------------------------------------------
// Data boundary helpers (model-agnostic)
// ---------------------------------------------------------------------------

/**
 * Copy posterior summaries from an ADO controller result onto a jsPsych choice row.
 *
 * This is the data boundary for posterior fields that later recovery/validation
 * code can read from the saved jsPsych JSON. Each choice row carries the posterior
 * that RESULTED from it (i.e. after its response was incorporated).
 *
 * @param {Object} data - jsPsych choice-trial data row, mutated in place.
 * @param {Object} ado_state - Controller state with post_mean/post_sd.
 */
function copyPosteriorFields(data, ado_state) {
  if (ado_state.post_mean) {
    for (const param of Object.keys(ado_state.post_mean)) {
      data["post_mean_" + param] = ado_state.post_mean[param];
    }
  }
  if (ado_state.post_sd) {
    for (const param of Object.keys(ado_state.post_sd)) {
      data["post_sd_" + param] = ado_state.post_sd[param];
    }
  }
}

/**
 * Copy design-selection diagnostics onto a jsPsych choice row.
 *
 * selection_time_ms is the batch-level time spent choosing the current testlet.
 * ado_mutual_info is the metric for the specific design presented on this row.
 *
 * @param {Object} data - jsPsych choice-trial data row, mutated in place.
 * @param {Object} ado_state - Controller state that selected the current design.
 * @param {?Object} design_metric - Metric aligned with the current design.
 */
function copySelectionFields(data, ado_state, design_metric) {
  data.ado_selection_time_ms =
    ado_state && ado_state.selection_time_ms != null ? ado_state.selection_time_ms : null;
  const normalized = normalizeDesignMetric(design_metric);
  data.ado_mutual_info = normalized.mutual_info;
}

// ---------------------------------------------------------------------------
// The generic ADO timeline
// ---------------------------------------------------------------------------

/** Validate a testlet size (choice trials between refits); null/undefined means 1. */
function normalizeTestletSize(value) {
  if (value == null) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`testlet_size must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Create the generic adaptive jsPsych timeline fragment for any ADO controller.
 *
 * The timeline depends only on the ADO controller contract (a synchronous start()
 * that provides the first design(s) from prior draws; an async update(trial_data)
 * that returns posterior summaries plus the next design(s) and optional aligned
 * design-selection metrics) and on the facade's trial factory. It is independent
 * of whether the controller is mock-backed or the in-browser Stan controller, and
 * of how the stimulus is drawn.
 *
 * @param {Object} jsPsych - jsPsych instance returned by initJsPsych().
 * @param {Object} adaptive_controller - Controller with sync start and async update.
 * @param {Object} config - { n_trials, testlet_size?, stopping?, response_labels,
 *                            choices, getChoiceTrials, describeDesign? }.
 * @param {Object} run_context - Debug and run metadata copied onto ADO data rows.
 * @param {Object} [hooks] - { onTimelineStart?, onTimelineFinish? } facade
 *   activation hooks (controller-reuse bookkeeping).
 * @returns {Array} jsPsych timeline fragment (a single nested-timeline node).
 */
function createAdoTimeline(jsPsych, adaptive_controller, config, run_context = {}, hooks = {}) {
  let ado_state = null;
  let current_design = null;
  let current_design_metric = null;
  let design_queue = [];
  let design_metric_queue = [];
  let testlet_rows = [];

  if (typeof config.getChoiceTrials !== "function") {
    throw new Error("createAdoTimeline: config.getChoiceTrials must be a function.");
  }
  const testlet_size = normalizeTestletSize(config.testlet_size);

  /**
   * Surface an adaptive-controller failure instead of letting the run continue
   * against a stale design (e.g. the Stan worker failed to load or sampling
   * errored). Ends the experiment with a visible message.
   *
   * @param {Error} error - The failure from update() or the scheduling contract.
   */
  function failExperiment(error) {
    const message = String((error && error.message) || error);
    console.error("Adaptive controller failed:", error);
    const html =
      "<p>The experiment encountered an error and cannot continue.</p>" +
      '<p style="color: #9ca3af; font-size: 0.85rem;">' +
      message +
      "</p>";
    if (jsPsych && typeof jsPsych.abortExperiment === "function") {
      jsPsych.abortExperiment(html, { ado_event: "error", ado_error: message });
    } else if (jsPsych && typeof jsPsych.endExperiment === "function") {
      jsPsych.endExperiment(html, { ado_event: "error", ado_error: message });
    }
  }

  function designsFromResult(result) {
    if (result.next_designs && result.next_designs.length) {
      return result.next_designs.slice();
    }
    return result.next_design != null ? [result.next_design] : [];
  }

  // Install a controller result as the live state: the head of its design batch
  // becomes the current design and the rest queue up for the testlet.
  function setDesignQueue(result) {
    ado_state = result;
    if (testlet_size > 1 && !result.next_designs) {
      throw new Error(
        "Adaptive controller did not return next_designs; testlet_size > 1 requires a batch-aware controller.",
      );
    }
    design_queue = designsFromResult(result);
    design_metric_queue = metricsFromResult(result, design_queue.length);
    current_design = design_queue.shift() ?? null;
    current_design_metric = design_metric_queue.shift() ?? null;
  }

  // Advance to the next prefetched design inside a testlet (no controller update).
  function advanceWithinTestlet() {
    current_design = design_queue.shift() ?? null;
    current_design_metric = design_metric_queue.shift() ?? null;
    if (current_design == null) {
      throw new Error(
        "ADO design queue underflow inside a testlet: the controller returned fewer designs than testlet_size.",
      );
    }
  }

  function copyUpdateFields(data, result, batch_length, next_designs, next_design_metrics) {
    data.ado_event = "update";
    data.ado_session_id = result.session_id;
    data.ado_trial_index = result.trial_index;
    data.ado_testlet_size = batch_length;
    data.ado_mode = run_context.ado_mode;
    data.controller_mode = run_context.controller_mode;
    data.design_strategy = run_context.design_strategy;
    data.ado_next_design = result.next_design;
    data.ado_next_designs = next_designs;
    data.ado_next_design_metrics = next_design_metrics;
    data.ado_next_selection_time_ms = result.selection_time_ms ?? null;
    data.ado_max_mutual_info = result.max_mutual_info ?? null;
    data.ado_post_mean = result.post_mean;
    data.ado_post_sd = result.post_sd;
    data.ado_api_latency_ms = result.api_latency_ms;
    data.ado_realized_information_gain = result.realized_information_gain ?? null;
    data.ado_realized_information_gains = result.realized_information_gains ?? null;
    data.ado_should_stop = Boolean(result.should_stop);
    data.ado_stop_reason = result.stop_reason ?? null;
  }

  // The controller's start() is synchronous by contract: the first design comes
  // from JS prior draws (no WASM needed), and the Stan controller kicks off its
  // worker init in the background for update() to await. It runs at TIMELINE
  // start (via on_timeline_start below), not at build time: the prior-draw MI
  // scan over the grid can take hundreds of ms on large grids, and deferring it
  // keeps page load unblocked and routes failures through failExperiment instead
  // of an uncaught page-setup exception.
  function initializeAdo() {
    const start_result = adaptive_controller.start(run_context);
    if (start_result && typeof start_result.then === "function") {
      throw new Error(
        "createAdoTimeline: adaptive_controller.start() must return the initial design state synchronously.",
      );
    }
    setDesignQueue(start_result);
  }

  // Adaptive stopping (#21): build up to max_trials adaptive steps, each testlet
  // wrapped in a node that is skipped once the controller signals should_stop.
  // With no stopping config, max_trials = config.n_trials and nothing is ever
  // skipped, so the run is fixed-length and behaves exactly as before.
  // normalizeStoppingConfig already resolves max_trials to config.n_trials when no
  // stopping config is given, so this is the single effective trial cap.
  const stopping_resolved = normalizeStoppingConfig(config.stopping, config.n_trials);
  const max_trials = stopping_resolved.max_trials;
  let stopped = false;

  const trials = [];
  let testlet_trials = [];

  for (let i = 0; i < max_trials; i++) {
    // ctx is read lazily by the trial property functions, so the live design and
    // controller state are picked up when the trial actually runs.
    const ctx = {
      getDesign: () => current_design,
      getState: () => ado_state,
      choices: config.choices,
      response_labels: config.response_labels,
      run_context,
      trial_number: i + 1,
    };

    const choice_trials = config.getChoiceTrials(ctx);
    if (!Array.isArray(choice_trials) || choice_trials.length === 0) {
      throw new Error(
        "createAdoTimeline: getChoiceTrials(ctx) must return a non-empty trial array.",
      );
    }

    const response_trials = choice_trials.filter((t) => t && t.__ado_is_response);
    if (response_trials.length !== 1) {
      throw new Error(
        `createAdoTimeline: an adaptive step must contain exactly one response-collecting trial ` +
          `(marked by the controller facade); got ${response_trials.length}.`,
      );
    }

    // The design queue advances at the END of the previous step, so by the time
    // this trial's parameters are evaluated the design is already fresh. on_start
    // only asserts the contract (a null design means the controller under-delivered).
    const first_trial = choice_trials[0];
    const inner_on_start = first_trial.on_start;
    first_trial.on_start = function (trial) {
      if (current_design == null) {
        failExperiment(new Error("ADO design queue underflow at choice trial."));
        return;
      }
      if (inner_on_start) {
        inner_on_start.call(this, trial);
      }
    };

    // Compose the ADO finalize step onto the response trial's own on_finish (which
    // the facade already composed over the user's on_finish): record the outcome +
    // design + posterior on the data row. jsPsych 8 awaits these composed handlers,
    // so the next adaptive trial cannot render until the design is ready.
    const response_trial = response_trials[0];
    delete response_trial.__ado_is_response;
    const inner_on_finish = response_trial.on_finish;
    const at_boundary = (i + 1) % testlet_size === 0 || i + 1 === max_trials;

    // Run at the end of the whole adaptive step (after the LAST trial, which may
    // come after the response trial — e.g. a feedback screen): refit + refill the
    // queue at testlet boundaries, or advance to the next prefetched design inside
    // a testlet. Errors are stamped on the given row and abort visibly.
    const runStepEnd = async function (error_row) {
      try {
        if (at_boundary) {
          const batch = testlet_rows.slice();
          testlet_rows.length = 0;
          const payload = testlet_size === 1 ? batch[0] : batch;
          const result = await adaptive_controller.update(payload);
          setDesignQueue(result);
          stopped = Boolean(result.should_stop);
          logAdoTrial(run_context, batch[batch.length - 1], result, config);
          appendPosteriorHistory(run_context, result);
          appendInformationGainHistory(run_context, batch, result);
          const next_designs = designsFromResult(result);
          const next_design_metrics = metricsFromResult(result, next_designs.length);
          for (const row of batch) {
            copyPosteriorFields(row, result);
            copyUpdateFields(row, result, batch.length, next_designs, next_design_metrics);
          }
          updateLiveCharts(run_context.param_history || {}, ado_state, run_context);
          updateInformationGainPanel(run_context);
        } else {
          advanceWithinTestlet();
        }
      } catch (error) {
        error_row.ado_event = "error";
        error_row.ado_error = String((error && error.message) || error);
        failExperiment(error);
        throw error;
      }
    };

    const last_trial = choice_trials[choice_trials.length - 1];
    const response_is_last = response_trial === last_trial;

    response_trial.on_finish = async function (data) {
      try {
        if (inner_on_finish) {
          await Promise.resolve(inner_on_finish.call(this, data));
        }
      } catch (error) {
        // A missing/invalid ado.recordResponse(...) must fail loudly, not hang the
        // run or feed garbage to Stan.
        data.ado_event = "error";
        data.ado_error = String((error && error.message) || error);
        failExperiment(error);
        throw error;
      }
      const design = current_design;
      const choice = data.__ado_response;
      delete data.__ado_response;
      // The plugin's own raw response (button index, key, slider value) stays on
      // data.response; choice is the validated model outcome recorded by the user.
      data.choice = choice;
      // Discrete responses map the outcome index to a label; continuous responses
      // have no labels, so the label is simply null there.
      data.choice_label = config.response_labels ? (config.response_labels[choice] ?? null) : null;
      data.model_id = run_context.model_id ?? null;
      data.ado_session_id = ado_state ? ado_state.session_id : null;
      data.trial_number = i + 1;
      data.ado_design = { ...design };
      data.testlet_index = Math.floor(i / testlet_size);
      data.testlet_position = i % testlet_size;
      copySelectionFields(data, ado_state, current_design_metric);
      testlet_rows.push(data);

      if (response_is_last) {
        await runStepEnd(data);
      }
    };

    // When trials follow the response trial (feedback screens etc.), they must
    // still render THIS step's design, so the queue advance/update waits for the
    // step's final trial.
    if (!response_is_last) {
      const inner_last_on_finish = last_trial.on_finish;
      last_trial.on_finish = async function (data) {
        if (inner_last_on_finish) {
          await Promise.resolve(inner_last_on_finish.call(this, data));
        }
        await runStepEnd(data);
      };
    }

    testlet_trials.push(...choice_trials);

    if (at_boundary) {
      // Skip this whole testlet (its choices + update) once a prior testlet's update
      // set `stopped`. The first testlet always runs (stopped starts false).
      trials.push({ timeline: testlet_trials, conditional_function: () => !stopped });
      testlet_trials = [];
    }
  }

  return [
    {
      timeline: trials,
      // on_timeline_start fires before the first child trial's parameters are
      // resolved, so the first design is in place exactly when it's needed and a
      // start() failure aborts visibly instead of crashing page setup. The facade
      // receives the live accessors here (bind-once, instead of a side channel
      // through every getChoiceTrials call).
      on_timeline_start: () => {
        try {
          initializeAdo();
        } catch (error) {
          failExperiment(error);
          throw error;
        }
        if (typeof hooks.onTimelineStart === "function") {
          hooks.onTimelineStart({
            getDesign: () => current_design,
            getState: () => ado_state,
          });
        }
      },
      // On finish, hand the facade a lightweight final snapshot (posterior
      // summaries without the draw arrays) so post-run reads like a debrief's
      // getState() keep working while the controller/grid/draws become
      // collectable.
      on_timeline_finish: () => {
        finalizeDebugUi(run_context);
        if (typeof hooks.onTimelineFinish === "function") {
          const final_state = ado_state ? { ...ado_state, posterior_draws: null } : null;
          const final_design = current_design;
          hooks.onTimelineFinish({
            getDesign: () => final_design,
            getState: () => final_state,
          });
        }
      },
    },
  ];
}

export { createAdoTimeline, normalizeTestletSize };
