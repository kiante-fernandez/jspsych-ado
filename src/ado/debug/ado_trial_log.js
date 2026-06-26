import { formatPosteriorDrawCharts } from "./posterior_debug_charts.js";
import { normalizeDesignMetric } from "../design_metrics.js";

// Per-trial ADO debug console logging + the small number formatters it uses (DEBUG
// ONLY, model-agnostic). logAdoTrial prints a readable summary of each finished
// update — presented design, response, posterior mean/sd per parameter, the next
// design, MI, and latency — plus a collapsed table with posterior histograms.

function formatDebugNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "NA";
  }
  return Number(value).toPrecision(digits);
}

function formatDebugLatency(value) {
  if (value === null || value === undefined) {
    return "not measured";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "not measured";
  }
  if (number < 1) {
    return `${(number * 1000).toPrecision(3)} us`;
  }
  if (number < 10) {
    return `${number.toPrecision(3)} ms`;
  }
  return `${Math.round(number)} ms`;
}

/**
 * Describe a design for the debug log. Models may supply a task-specific
 * presentation.describeDesign(design) -> string[]; otherwise fall back to
 * generic key=value lines so any model is debuggable out of the box.
 *
 * @param {Object} design - The design object.
 * @param {Object} config - Timeline config (may carry presentation.describeDesign).
 * @returns {string[]} Lines describing the design.
 */
function describeDesign(design, config) {
  if (!design) {
    return ["(none)"];
  }
  const describe = config.presentation && config.presentation.describeDesign;
  if (typeof describe === "function") {
    return describe(design);
  }
  return Object.entries(design).map(([key, value]) => `${key}: ${value}`);
}

/**
 * Print a readable summary of the just-finished ADO update (debug only).
 *
 * @param {Object} run_context - Current run settings (debug, ado_mode, controller_mode, design_strategy).
 * @param {Object} trial_data - Completed jsPsych choice row.
 * @param {Object} ado_result - Updated controller state.
 * @param {Object} config - Timeline config.
 */
function logAdoTrial(run_context, trial_data, ado_result, config) {
  if (!run_context.debug) {
    return;
  }

  try {
    if (typeof console === "undefined") {
      return;
    }

    const next_design = ado_result.next_design;
    const post_mean = ado_result.post_mean || {};
    const post_sd = ado_result.post_sd || {};
    const total_trials = config && config.n_trials ? config.n_trials : "?";
    const mode_label =
      run_context.controller_mode === "stan" && run_context.design_strategy
        ? `${run_context.controller_mode}/${run_context.design_strategy}`
        : run_context.controller_mode || run_context.ado_mode;
    const label = `ADO update ${trial_data.trial_number}/${total_trials} | ${mode_label} | response: ${trial_data.choice_label}`;
    const summary = [
      `${label} | latency: ${formatDebugLatency(ado_result.api_latency_ms)}`,
      `Design selection: ${formatDebugLatency(ado_result.selection_time_ms)} | max MI: ${formatDebugNumber(ado_result.max_mutual_info)}`,
      "",
      "Presented:",
      ...describeDesign(trial_data.ado_design, config).map((line) => "  " + line),
      "  mutual_info: " + formatDebugNumber(trial_data.ado_mutual_info),
      "  realized_information_gain: " + formatDebugNumber(ado_result.realized_information_gain),
      "",
      "Posterior after response:",
      ...Object.keys(post_mean).map(
        (param) =>
          `  ${param}: mean ${formatDebugNumber(post_mean[param])}, sd ${formatDebugNumber(post_sd[param])}`,
      ),
      "",
      // next_design is null on the final update (no further trial to show it on).
      next_design
        ? [
            "Next ADO design:",
            ...describeDesign(next_design, config).map((line) => "  " + line),
          ].join("\n")
        : "Next ADO design: (final trial; none)",
    ].join("\n");

    console.log(summary);

    if (console.groupCollapsed && console.table && console.groupEnd) {
      console.groupCollapsed(`${label} details`);
      const design_rows = [
        { when: "presented", mutual_info: trial_data.ado_mutual_info, ...trial_data.ado_design },
      ];
      const next_designs = ado_result.next_designs || (next_design ? [next_design] : []);
      const next_metrics = Array.isArray(ado_result.next_design_metrics)
        ? ado_result.next_design_metrics
        : [];
      if (next_designs.length) {
        next_designs.forEach(function (design, index) {
          const metric = normalizeDesignMetric(next_metrics[index]);
          design_rows.push({
            when: "next " + (index + 1),
            mutual_info: metric.mutual_info,
            ...design,
          });
        });
      }
      console.table(design_rows);
      console.table(
        Object.keys(post_mean).map((param) => ({
          parameter: param,
          mean: post_mean[param],
          sd: post_sd[param],
        })),
      );
      const histograms = formatPosteriorDrawCharts(
        ado_result.posterior_draws,
        Object.keys(post_mean),
        run_context.posterior_display,
      );
      if (histograms) {
        console.log(histograms);
      }
      console.groupEnd();
    }
  } catch (error) {
    console.warn("ADO debug logging failed", error);
  }
}

export { logAdoTrial };
