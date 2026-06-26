import { normalizeStoppingConfig } from "./stopping.js";
import { normalizeDesignMetric, metricsFromResult } from "./design_metrics.js";
import { logAdoTrial } from "./debug/ado_trial_log.js";
import {
  updateLiveCharts,
  appendPosteriorHistory,
  appendInformationGainHistory,
  updateInformationGainPanel,
} from "./debug/posterior_convergence_charts.js";
import { requirePlugin, copySimulationAuditFields, htmlButtonChoice } from "./response_trials.js";

// Generic adaptive-design-optimization (ADO) jsPsych timeline.
//
// This module is MODEL- AND STIMULUS-AGNOSTIC. It knows nothing about delay
// discounting, dots, or any particular task. It wires together:
//   - an ADO controller (start/update; mock or in-browser Stan), and
//   - a task "presentation" spec that supplies the per-trial stimulus,
// into the standard ADO loop: pick a design -> show it -> record the choice ->
// re-infer + pick the next design. Everything task-specific (how a design is
// rendered, which raw response maps to which model outcome) is provided by the
// registered task, so adding a model never requires editing this file.
//
// The pieces it composes live in sibling modules:
//   - response_trials.js — the response-collecting trial factories (the stimulus
//     seam: htmlButtonChoice / canvasFrame / canvasResponse / canvasSliderChoice)
//     plus jsPsych plugin resolution and the simulation hooks.
//   - debug/ado_trial_log.js — per-trial debug console logging + formatters.
//   - debug/posterior_convergence_charts.js — live posterior/EIG debug charts.
//
// The presentation contract (supplied by the task, threaded through config):
//   - presentation.getChoiceTrials(ctx) -> Array<jsPsychTrial>
//       Return the jsPsych trials shown for one choice. EXACTLY ONE of them must
//       be the response-collecting trial built by one of the factories above
//       (htmlButtonChoice / canvasResponse / canvasSliderChoice), which marks itself
//       and stores the raw response (a choice index for discrete tasks, or a slider
//       value for continuous tasks) on data.__ado_response. ctx exposes:
//         { getDesign(), getState(), choices, response_labels, run_context,
//           trial_number, task }
//   - CONVENIENCE PATH for the common single-button case: instead of
//       getChoiceTrials, supply presentation.makeStimulus(design) -> HTML (plus
//       optional button_html(design) -> string[], keymap {key:index}, prompt);
//       the timeline builds the trial via htmlButtonChoice(...) for you.
//   - presentation.describeDesign(design) -> string[] (optional): human-readable
//       lines for the debug log; defaults to generic key=value pairs.
//
// config: { n_trials, testlet_size?, response_labels, presentation, choices,
//           responseToOutcome?, task? }. responseToOutcome(design, choiceIndex)
// -> outcome index defaults to identity (raw button index IS the model outcome).

// ---------------------------------------------------------------------------
// Data boundary helpers (model-agnostic)
// ---------------------------------------------------------------------------

/**
 * Copy posterior summaries from the current ADO state onto a jsPsych choice row.
 *
 * This is the data boundary for posterior fields that later recovery/validation
 * code can read from the saved jsPsych JSON.
 *
 * @param {Object} data - jsPsych choice-trial data row, mutated in place.
 * @param {Object} ado_state - Current controller state with post_mean/post_sd.
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

/**
 * Create the generic adaptive jsPsych timeline fragment for any registered model.
 *
 * The timeline depends only on the ADO controller contract (start() provides the
 * first design(s); update(trial_data) returns posterior summaries plus the next
 * design(s) and optional aligned design-selection metrics) and on the task's
 * presentation spec. It is independent of whether the controller is mock-backed
 * or the in-browser Stan controller, and of how the stimulus is drawn.
 *
 * @param {Object} jsPsych - jsPsych instance returned by initJsPsych().
 * @param {Object} adaptive_controller - Controller with start/update methods.
 * @param {Object} config - { n_trials, response_labels, presentation, choices,
 *                            testlet_size?, responseToOutcome?, task? }.
 * @param {Object} run_context - Run settings and optional simulation hook.
 * @returns {Array} jsPsych timeline fragment.
 */
function createAdoTimeline(jsPsych, adaptive_controller, config, run_context = {}) {
  let ado_state = null;
  let current_design = null;
  let current_design_metric = null;
  let current_designs = [];
  let current_design_metrics = [];
  let testlet_rows = [];

  const presentation = config.presentation;
  if (
    !presentation ||
    (typeof presentation.getChoiceTrials !== "function" &&
      typeof presentation.makeStimulus !== "function")
  ) {
    throw new Error(
      "createAdoTimeline: config.presentation must provide getChoiceTrials or makeStimulus.",
    );
  }
  // Default: the raw button/key index IS the model outcome. Tasks where the
  // outcome depends on the design (e.g. "chose the more numerous side") override this.
  const responseToOutcome = config.responseToOutcome || ((_design, index) => index);
  const task = config.task || run_context.model_id || "ado";
  const testlet_size = normalizeTestletSize(config.testlet_size);

  // Resolve plugin classes once (injected config.plugins, else UMD globals). Fail
  // fast on the always-needed call-function plugin so bundler consumers get a clear
  // message instead of a "type is undefined" deep in jsPsych. The choice-trial
  // plugins are resolved lazily in the factories (only the task's path needs them).
  const injected_plugins = config.plugins;
  const callFunctionPlugin = requirePlugin(injected_plugins, "callFunction");

  /**
   * Surface an adaptive-controller failure instead of letting the async trial hang
   * forever. Completes the current call-function trial and ends the experiment with
   * a visible message (e.g. the Stan worker failed to load or sampling errored).
   *
   * @param {Error} error - The rejection from start()/update().
   * @param {Function} done - jsPsych call-function done callback.
   */
  function failExperiment(error, done) {
    const message = String((error && error.message) || error);
    console.error("Adaptive controller failed:", error);
    done({ ado_event: "error", ado_error: message });
    jsPsych.endExperiment(
      "<p>The experiment encountered an error and cannot continue.</p>" +
        '<p style="color: #9ca3af; font-size: 0.85rem;">' +
        message +
        "</p>",
    );
  }

  function normalizeTestletSize(value) {
    if (value == null) {
      return 1;
    }
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`createAdoTimeline: testlet_size must be a positive integer, got ${value}`);
    }
    return value;
  }

  function designsFromResult(result) {
    if (result.next_designs && result.next_designs.length) {
      return result.next_designs.slice();
    }
    return result.next_design != null ? [result.next_design] : [];
  }

  const initialize_ado = {
    type: callFunctionPlugin,
    async: true,
    func: function (done) {
      adaptive_controller
        .start(run_context)
        .then((result) => {
          ado_state = result;
          if (testlet_size > 1 && !result.next_designs) {
            return failExperiment(
              new Error(
                "Adaptive controller did not return next_designs; testlet_size > 1 requires a batch-aware controller.",
              ),
              done,
            );
          }
          current_designs = designsFromResult(result);
          current_design_metrics = metricsFromResult(result, current_designs.length);
          current_design = current_designs[0] ?? null;
          current_design_metric = current_design_metrics[0] ?? null;
          done({
            ado_event: "start",
            ado_session_id: result.session_id,
            ado_trial_index: result.trial_index,
            ado_mode: run_context.ado_mode,
            controller_mode: run_context.controller_mode,
            design_strategy: run_context.design_strategy,
            ado_next_design: result.next_design,
            ado_next_designs: current_designs.slice(),
            ado_next_design_metrics: current_design_metrics.slice(),
            ado_selection_time_ms: result.selection_time_ms ?? null,
            ado_max_mutual_info: result.max_mutual_info ?? null,
          });
        })
        .catch((error) => failExperiment(error, done));
    },
  };

  // Adaptive stopping (#21): build up to max_trials testlets, each wrapped in a
  // node that is skipped once the controller signals should_stop (set in the update
  // below). With no stopping config, max_trials = config.n_trials and nothing is
  // ever skipped, so the run is fixed-length and behaves exactly as before.
  // normalizeStoppingConfig already resolves max_trials to config.n_trials when no
  // stopping config is given, so this is the single effective trial cap.
  const stopping_resolved = normalizeStoppingConfig(config.stopping, config.n_trials);
  const max_trials = stopping_resolved.max_trials;
  let stopped = false;

  const trials = [initialize_ado];
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
      task,
      // Tasks that build canvas trials in getChoiceTrials pass these to
      // canvasFrame/canvasResponse so injected plugins reach those factories too.
      plugins: injected_plugins,
    };

    const choice_trials =
      typeof presentation.getChoiceTrials === "function"
        ? presentation.getChoiceTrials(ctx)
        : [htmlButtonChoice(ctx, presentation, injected_plugins)];

    const response_trials = choice_trials.filter((t) => t && t.__ado_is_response);
    if (response_trials.length !== 1) {
      throw new Error(
        `createAdoTimeline: a choice must contain exactly one response-collecting trial ` +
          `(built via htmlButtonChoice/canvasResponse/canvasSliderChoice); got ${response_trials.length}.`,
      );
    }

    const first_trial = choice_trials[0];
    const inner_on_start = first_trial.on_start;
    first_trial.on_start = function (trial) {
      current_design = current_designs.shift();
      current_design_metric = current_design_metrics.shift() ?? null;
      if (current_design == null) {
        console.error("ADO design queue underflow at choice trial.");
        jsPsych.endExperiment("<p>The experiment encountered an error and cannot continue.</p>");
        return;
      }
      if (inner_on_start) {
        inner_on_start.call(this, trial);
      }
    };

    // Compose the ADO finalize step onto the response trial's own on_finish:
    // map the raw response to a model outcome, record the full design + labels,
    // and copy the posterior summaries so downstream code reads them from data.
    const response_trial = response_trials[0];
    delete response_trial.__ado_is_response;
    const inner_on_finish = response_trial.on_finish;
    response_trial.on_finish = function (data) {
      if (inner_on_finish) {
        inner_on_finish.call(this, data);
      }
      copySimulationAuditFields(data, run_context);
      const design = current_design;
      const choice_raw = data.__ado_response;
      const choice = responseToOutcome(design, choice_raw);
      data.choice_raw = choice_raw;
      data.choice = choice;
      // Discrete tasks map the outcome index to a label; continuous tasks have no
      // labels (response_labels is absent), so the label is simply null there.
      data.choice_label = config.response_labels ? (config.response_labels[choice] ?? null) : null;
      data.ado_design = { ...design };
      data.testlet_index = Math.floor(i / testlet_size);
      data.testlet_position = i % testlet_size;
      copyPosteriorFields(data, ado_state);
      copySelectionFields(data, ado_state, current_design_metric);
      testlet_rows.push(data);
    };

    testlet_trials.push(...choice_trials);

    const at_boundary = (i + 1) % testlet_size === 0 || i + 1 === max_trials;
    if (at_boundary) {
      testlet_trials.push({
        type: callFunctionPlugin,
        async: true,
        func: function (done) {
          const batch = testlet_rows.slice();
          testlet_rows.length = 0;
          const payload = testlet_size === 1 ? batch[0] : batch;
          adaptive_controller
            .update(payload)
            .then((result) => {
              ado_state = result;
              // Once the controller signals a stop, the remaining testlet nodes skip
              // via their conditional_function below, ending the run early.
              stopped = Boolean(result.should_stop);
              current_designs = designsFromResult(result);
              current_design_metrics = metricsFromResult(result, current_designs.length);
              current_design = current_designs[0] ?? null;
              current_design_metric = current_design_metrics[0] ?? null;
              logAdoTrial(run_context, batch[batch.length - 1], result, config);
              appendPosteriorHistory(run_context, result);
              appendInformationGainHistory(run_context, batch, result);
              done({
                ado_event: "update",
                ado_session_id: result.session_id,
                ado_trial_index: result.trial_index,
                ado_testlet_size: batch.length,
                ado_mode: run_context.ado_mode,
                controller_mode: run_context.controller_mode,
                design_strategy: run_context.design_strategy,
                ado_next_design: result.next_design,
                ado_next_designs: current_designs.slice(),
                ado_next_design_metrics: current_design_metrics.slice(),
                ado_post_mean: result.post_mean,
                ado_post_sd: result.post_sd,
                ado_api_latency_ms: result.api_latency_ms,
                ado_selection_time_ms: result.selection_time_ms ?? null,
                ado_max_mutual_info: result.max_mutual_info ?? null,
                ado_realized_information_gain: result.realized_information_gain ?? null,
                ado_realized_information_gains: result.realized_information_gains ?? null,
                // The EIG used for the stop decision is the grid-max MI already
                // recorded as ado_max_mutual_info; no separate ado_eig column.
                ado_should_stop: Boolean(result.should_stop),
                ado_stop_reason: result.stop_reason ?? null,
              });
            })
            .catch((error) => failExperiment(error, done));
        },
        on_finish: function () {
          updateLiveCharts(run_context.param_history || {}, ado_state, run_context);
          updateInformationGainPanel(run_context);
        },
      });
      // Skip this whole testlet (its choices + update) once a prior testlet's update
      // set `stopped`. The first testlet always runs (stopped starts false).
      trials.push({ timeline: testlet_trials, conditional_function: () => !stopped });
      testlet_trials = [];
    }
  }

  return trials;
}

export { createAdoTimeline };
