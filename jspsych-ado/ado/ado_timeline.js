import { updateInfoGainDebugPanel, removeInfoGainDebugPanel } from "./debug_trace_charts.js";
import { formatPosteriorDrawCharts } from "./posterior_debug_charts.js";

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
// The presentation contract (supplied by the task, threaded through config):
//   - presentation.getChoiceTrials(ctx) -> Array<jsPsychTrial>
//       Return the jsPsych trials shown for one choice. EXACTLY ONE of them must
//       be the response-collecting trial built by one of the factories below
//       (htmlButtonChoice / canvasResponse), which marks itself and stores the
//       raw response index on data.__ado_response. ctx exposes:
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

function normalizeDesignMetric(metric) {
  if (!metric || typeof metric !== "object") {
    return { mutual_info: null };
  }
  const mutual_info = metric.mutual_info;
  return {
    ...metric,
    mutual_info: typeof mutual_info === "number" && Number.isFinite(mutual_info) ? mutual_info : null,
  };
}

function metricsFromResult(result, design_count) {
  const metrics = Array.isArray(result.next_design_metrics) ? result.next_design_metrics : [];
  const normalized = [];
  for (let i = 0; i < design_count; i++) {
    normalized.push(normalizeDesignMetric(metrics[i]));
  }
  return normalized;
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
  data.ado_selection_time_ms = ado_state && ado_state.selection_time_ms != null
    ? ado_state.selection_time_ms
    : null;
  const normalized = normalizeDesignMetric(design_metric);
  data.ado_mutual_info = normalized.mutual_info;
}

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

function hasFiniteDebugValue(value) {
  return typeof value === "number" && Number.isFinite(value);
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
    const mode_label = run_context.controller_mode === "stan" && run_context.design_strategy
      ? `${run_context.controller_mode}/${run_context.design_strategy}`
      : (run_context.controller_mode || run_context.ado_mode);
    const label = `ADO update ${trial_data.trial_number}/${total_trials} | ${mode_label} | response: ${trial_data.choice_label}`;
    const summary = [
      `${label} | latency: ${formatDebugLatency(ado_result.api_latency_ms)}`,
      `Design selection: ${formatDebugLatency(ado_result.selection_time_ms)} | max MI: ${formatDebugNumber(ado_result.max_mutual_info)}`,
      "",
      "Presented:",
      ...describeDesign(trial_data.ado_design, config).map(line => "  " + line),
      "  mutual_info: " + formatDebugNumber(trial_data.ado_mutual_info),
      "  realized_information_gain: " + formatDebugNumber(ado_result.realized_information_gain),
      "",
      "Posterior after response:",
      ...Object.keys(post_mean).map(param =>
        `  ${param}: mean ${formatDebugNumber(post_mean[param])}, sd ${formatDebugNumber(post_sd[param])}`
      ),
      "",
      // next_design is null on the final update (no further trial to show it on).
      next_design
        ? ["Next ADO design:", ...describeDesign(next_design, config).map(line => "  " + line)].join("\n")
        : "Next ADO design: (final trial; none)",
    ].join("\n");

    console.log(summary);

    if (console.groupCollapsed && console.table && console.groupEnd) {
      console.groupCollapsed(`${label} details`);
      const design_rows = [{ when: "presented", mutual_info: trial_data.ado_mutual_info, ...trial_data.ado_design }];
      const next_designs = ado_result.next_designs || (next_design ? [next_design] : []);
      const next_metrics = Array.isArray(ado_result.next_design_metrics) ? ado_result.next_design_metrics : [];
      if (next_designs.length) {
        next_designs.forEach(function(design, index) {
          const metric = normalizeDesignMetric(next_metrics[index]);
          design_rows.push({ when: "next " + (index + 1), mutual_info: metric.mutual_info, ...design });
        });
      }
      console.table(design_rows);
      console.table(Object.keys(post_mean).map(param => ({
        parameter: param,
        mean: post_mean[param],
        sd: post_sd[param],
      })));
      const histograms = formatPosteriorDrawCharts(
        ado_result.posterior_draws,
        Object.keys(post_mean),
        run_context.posterior_display
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

/**
 * Adapt the simulated participant function to jsPsych's trial simulation API.
 *
 * jsPsych expects simulation_options.data to contain plugin data such as
 * response and rt. Extra sim_* fields are kept in the final jsPsych data row.
 *
 * @param {Object} run_context - Current run settings (simulation_mode, simulate_choice).
 * @param {Object} design - Current design.
 * @returns {Object} jsPsych simulation_options object for the choice trial.
 */
function makeChoiceSimulationOptions(run_context, design) {
  if (!run_context.simulation_mode || !run_context.simulate_choice) {
    return {};
  }

  const simulation_data = run_context.simulate_choice(design);
  run_context.pending_simulation_data = simulation_data;
  return {
    data: simulation_data,
  };
}

function copySimulationAuditFields(data, run_context) {
  const simulation_data = run_context.pending_simulation_data;
  if (!simulation_data) {
    return;
  }
  for (const [key, value] of Object.entries(simulation_data)) {
    if ((key === "sim_draw" || key.startsWith("sim_")) && data[key] === undefined) {
      data[key] = value;
    }
  }
  run_context.pending_simulation_data = null;
}

// ---------------------------------------------------------------------------
// Live posterior charts (debug only; model-agnostic)
// ---------------------------------------------------------------------------

function formatAxisTick(v) {
  if (v === 0) return "0";
  if (Math.abs(v) < 0.01) return v.toExponential(1);
  return Number(v.toPrecision(2)).toString();
}

function getParamDisplay(param_name, posterior_display) {
  if (posterior_display && posterior_display[param_name]) {
    return posterior_display[param_name];
  }
  return { label: param_name };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function getParamAxisDomain(series, opts) {
  opts = opts || {};

  var data_lo = Infinity, data_hi = -Infinity;
  series.forEach(function(d) {
    var sd = d.sd || 0;
    var lo = d.mean - sd;
    var hi = d.mean + sd;
    if (Number.isFinite(lo)) {
      data_lo = Math.min(data_lo, lo);
    }
    if (Number.isFinite(hi)) {
      data_hi = Math.max(data_hi, hi);
    }
  });

  var has_data = Number.isFinite(data_lo) && Number.isFinite(data_hi);
  var has_preferred_range = isFiniteNumber(opts.y_min) && isFiniteNumber(opts.y_max) && opts.y_min < opts.y_max;
  var has_lower_bound = isFiniteNumber(opts.lower_bound);
  var has_upper_bound = isFiniteNumber(opts.upper_bound);
  var min_y_span = isFiniteNumber(opts.min_y_span) && opts.min_y_span > 0 ? opts.min_y_span : null;
  var axis_expanded = false;
  var axis_lower_bounded = has_lower_bound && has_data && data_lo < opts.lower_bound;
  var axis_upper_bounded = has_upper_bound && has_data && data_hi > opts.upper_bound;
  var y_min, y_max;

  if (!has_data) {
    if (has_preferred_range) {
      y_min = opts.y_min;
      y_max = opts.y_max;
    } else {
      y_min = has_lower_bound ? opts.lower_bound : -0.001;
      y_max = y_min + (min_y_span || 0.002);
    }
  } else if (data_hi > data_lo) {
    var span = data_hi - data_lo;
    var pad = span * 0.15;
    y_min = data_lo - pad;
    y_max = data_hi + pad;
    axis_expanded = has_preferred_range && (data_lo < opts.y_min || data_hi > opts.y_max);
  } else if (has_preferred_range && data_lo >= opts.y_min && data_hi <= opts.y_max) {
    y_min = opts.y_min;
    y_max = opts.y_max;
  } else {
    var half_span = (min_y_span || 0.002) / 2;
    y_min = data_lo - half_span;
    y_max = data_hi + half_span;
    axis_expanded = has_preferred_range && (data_lo < opts.y_min || data_hi > opts.y_max);
  }

  if (min_y_span && y_max - y_min < min_y_span) {
    var center = (y_min + y_max) / 2;
    y_min = center - min_y_span / 2;
    y_max = center + min_y_span / 2;
  }

  if (has_lower_bound && y_min < opts.lower_bound) {
    y_min = opts.lower_bound;
  }
  if (has_upper_bound && y_max > opts.upper_bound) {
    y_max = opts.upper_bound;
  }

  if (y_min >= y_max) {
    var fallback_span = min_y_span || 0.002;
    if (has_lower_bound && has_upper_bound && opts.lower_bound < opts.upper_bound) {
      fallback_span = Math.min(fallback_span, opts.upper_bound - opts.lower_bound);
      var bounded_center = has_data ? Math.min(opts.upper_bound - fallback_span / 2, Math.max(opts.lower_bound + fallback_span / 2, data_lo)) : (opts.lower_bound + opts.upper_bound) / 2;
      y_min = bounded_center - fallback_span / 2;
      y_max = bounded_center + fallback_span / 2;
    } else if (has_upper_bound) {
      y_max = opts.upper_bound;
      y_min = y_max - fallback_span;
      if (has_lower_bound && y_min < opts.lower_bound) {
        y_min = opts.lower_bound;
      }
    } else {
      y_min = has_lower_bound ? opts.lower_bound : y_min - fallback_span / 2;
      y_max = y_min + fallback_span;
    }
  }

  return {
    y_min: y_min,
    y_max: y_max,
    axis_expanded: axis_expanded,
    axis_lower_bounded: axis_lower_bounded,
    axis_upper_bounded: axis_upper_bounded,
  };
}

/**
 * Render a parameter posterior trajectory (mean ± SD per trial) as an SVG string.
 *
 * The visible y-axis is data-driven from the mean ± SD envelope. y_min/y_max
 * are preferred/fallback ranges, while lower_bound/upper_bound are true model
 * constraints used as hard display limits.
 *
 * @param {Array<{trial: number, mean: number, sd: number}>} series
 * @param {string} param_name - Parameter name ("k", "tau", ...).
 * @param {Object} [opts]
 * @param {number} [opts.width=500]
 * @param {number} [opts.height=200]
 * @param {string} [opts.label] - Display label for the parameter.
 * @param {number} [opts.y_min] - Preferred y minimum.
 * @param {number} [opts.y_max] - Preferred y maximum.
 * @param {number} [opts.lower_bound] - Hard lower display bound for constrained parameters.
 * @param {number} [opts.upper_bound] - Hard upper display bound for constrained parameters.
 * @param {number} [opts.min_y_span] - Minimum visible y-axis width.
 * @returns {string} SVG markup.
 */
function makeParamConvergenceSvg(series, param_name, opts) {
  opts = opts || {};
  var W = opts.width || 500, H = opts.height || 200;
  var ml = 44, mr = 12, mt = 12, mb = 34;
  var pw = W - ml - mr;
  var ph = H - mt - mb;
  var n = series.length;

  if (n === 0) {
    return "<svg width=\"" + W + "\" height=\"" + H + "\"><text x=\"" + (W / 2) + "\" y=\"" + (H / 2) + "\" text-anchor=\"middle\" font-size=\"12\" fill=\"#6b7280\">No data yet</text></svg>";
  }

  var axis = getParamAxisDomain(series, opts);
  var y_min = axis.y_min;
  var y_max = axis.y_max;

  function sx(i) { return ml + (n === 1 ? pw / 2 : (i / (n - 1)) * pw); }
  function sy(v) {
    if (v < y_min) {
      v = y_min;
    }
    if (v > y_max) {
      v = y_max;
    }
    return mt + ph - ((v - y_min) / (y_max - y_min)) * ph;
  }

  var band_top = [], band_bot = [];
  series.forEach(function(d, i) {
    band_top.push(sx(i) + "," + sy(d.mean + (d.sd || 0)));
    band_bot.unshift(sx(i) + "," + sy(d.mean - (d.sd || 0)));
  });
  var band_pts = band_top.concat(band_bot).join(" ");
  var line_pts = series.map(function(d, i) { return sx(i) + "," + sy(d.mean); }).join(" ");

  var y_ticks = "";
  for (var t = 0; t <= 3; t++) {
    var v = y_min + (y_max - y_min) * (t / 3);
    var yp = sy(v);
    y_ticks += "<line x1=\"" + ml + "\" y1=\"" + yp + "\" x2=\"" + (ml + pw) + "\" y2=\"" + yp + "\" stroke=\"#e5e7eb\" stroke-width=\"1\"/>"
      + "<text x=\"" + (ml - 4) + "\" y=\"" + (yp + 4) + "\" text-anchor=\"end\" font-size=\"9\" fill=\"#6b7280\">" + formatAxisTick(v) + "</text>";
  }

  var x_ticks = "";
  var tick_indices = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  tick_indices.forEach(function(i) {
    x_ticks += "<text x=\"" + sx(i) + "\" y=\"" + (mt + ph + 16) + "\" text-anchor=\"middle\" font-size=\"9\" fill=\"#6b7280\">" + series[i].trial + "</text>";
  });

  var param_label = opts.label || param_name;
  var axis_notes = [];
  if (axis.axis_expanded) {
    axis_notes.push("axis expanded");
  }
  if (axis.axis_lower_bounded) {
    axis_notes.push("lower bound");
  }
  if (axis.axis_upper_bounded) {
    axis_notes.push("upper bound");
  }
  var axis_note = axis_notes.length
    ? "<text x=\"" + (ml + pw) + "\" y=\"" + (mt + 10) + "\" text-anchor=\"end\" font-size=\"9\" fill=\"#b45309\">" + axis_notes.join("; ") + "</text>"
    : "";

  return "<svg width=\"" + W + "\" height=\"" + H + "\" style=\"display:block;\">"
    + "<rect x=\"" + ml + "\" y=\"" + mt + "\" width=\"" + pw + "\" height=\"" + ph + "\" fill=\"#f9fafb\" stroke=\"#e5e7eb\" stroke-width=\"1\"/>"
    + y_ticks
    + axis_note
    + "<polygon points=\"" + band_pts + "\" fill=\"rgba(99,102,241,0.15)\"/>"
    + "<polyline points=\"" + line_pts + "\" fill=\"none\" stroke=\"#4f46e5\" stroke-width=\"2\" stroke-linejoin=\"round\"/>"
    + x_ticks
    + "<text x=\"" + (ml + pw / 2) + "\" y=\"" + (H - 4) + "\" text-anchor=\"middle\" font-size=\"10\" fill=\"#374151\">Trial</text>"
    + "<text x=\"10\" y=\"" + (mt + ph / 2) + "\" text-anchor=\"middle\" font-size=\"10\" fill=\"#374151\" transform=\"rotate(-90 10 " + (mt + ph / 2) + ")\">" + param_label + "</text>"
    + "</svg>";
}

/**
 * Create or update the fixed bottom debug bar showing running posterior trajectories.
 *
 * Gated on run_context.debug — not shown to real participants. param_history is a
 * closure-maintained object built directly from controller results (not jsPsych.data,
 * because the call-function plugin wraps done() payloads under a "value" key).
 * One chart is rendered per parameter, side by side.
 *
 * @param {Object<string, Array<{trial, mean, sd}>>} param_history
 * @param {Object} ado_state
 * @param {Object} run_context
 */
function updateLiveCharts(param_history, ado_state, run_context) {
  if (!run_context.debug) {
    return;
  }

  var params = Object.keys(param_history);
  if (params.length === 0) {
    return;
  }

  var container = document.getElementById("ado-live-posterior-chart");
  if (!container) {
    container = document.createElement("div");
    container.id = "ado-live-posterior-chart";
    container.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,0.95);border-top:1px solid #e5e7eb;z-index:1000;pointer-events:none;padding:0.3rem 0;";
    document.body.appendChild(container);
  }

  var header = "<div style=\"text-align:center;font-size:0.7rem;color:#9ca3af;margin-bottom:0.1rem;\">Running posterior [debug]</div>";
  var charts_html = "<div style=\"display:flex;justify-content:center;gap:0.75rem;\">";
  params.forEach(function(param) {
    var display = getParamDisplay(param, run_context.posterior_display);
    var label = display.label || param;
    charts_html += "<div style=\"text-align:center;\">"
      + "<div style=\"font-size:0.7rem;color:#6b7280;margin-bottom:2px;\">" + label + "</div>"
      + makeParamConvergenceSvg(param_history[param], param, {
        width: 280,
        height: 150,
        label: label,
        y_min: display.y_min,
        y_max: display.y_max,
        lower_bound: display.lower_bound,
        upper_bound: display.upper_bound,
        min_y_span: display.min_y_span,
      })
      + "</div>";
  });
  charts_html += "</div>";

  container.innerHTML = header + charts_html;
}

/**
 * Build the debrief HTML shown on the finish page.
 *
 * Displays final posterior mean ± SD for each parameter and a full-size
 * convergence chart. Designed to be called from end_screen.on_start, after
 * all trials have completed and param_history is fully populated.
 *
 * @param {Object<string, Array<{trial, mean, sd}>>} param_history
 * @param {Object} posterior_display - Optional parameter labels and preferred y ranges.
 * @returns {string} HTML string with summary values and SVG charts.
 */
function makeDebriefStimulus(param_history, posterior_display) {
  var params = Object.keys(param_history);
  if (params.length === 0) {
    return "<h2>Finished</h2><p>The experiment is complete. Click SUBMIT to finish.</p>";
  }
  var last_values = params.map(function(param) {
    var series = param_history[param];
    if (!series.length) { return ""; }
    var last = series[series.length - 1];
    var display = getParamDisplay(param, posterior_display);
    var label = display.label || param;
    return "<p style=\"margin:0.25rem 0;font-size:0.9rem;color:#374151;\">"
      + "<strong>" + label + "</strong>: "
      + last.mean.toPrecision(3) + " ± " + last.sd.toPrecision(2) + "</p>";
  }).join("");
  var charts = "<div style=\"display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;margin-top:0.75rem;\">"
    + params.map(function(param) {
      var display = getParamDisplay(param, posterior_display);
      var label = display.label || param;
      return "<div style=\"text-align:center;\">"
        + "<div style=\"font-size:0.8rem;color:#6b7280;margin-bottom:4px;\">" + label + " posterior trajectory</div>"
        + makeParamConvergenceSvg(param_history[param], param, {
          width: 380,
          height: 220,
          label: label,
          y_min: display.y_min,
          y_max: display.y_max,
          lower_bound: display.lower_bound,
          upper_bound: display.upper_bound,
          min_y_span: display.min_y_span,
        })
        + "</div>";
    }).join("")
    + "</div>";
  return "<h2>Finished</h2>"
    + "<p style=\"color:#6b7280;font-size:0.85rem;\">Estimated parameters (posterior mean ± SD):</p>"
    + last_values
    + charts
    + "<p style=\"margin-top:1rem;\">Click SUBMIT to finish.</p>";
}

function appendPosteriorHistory(run_context, ado_result) {
  if (!ado_result.post_mean) {
    return;
  }
  if (!run_context.param_history) {
    run_context.param_history = {};
  }
  for (const param of Object.keys(ado_result.post_mean)) {
    if (!run_context.param_history[param]) {
      run_context.param_history[param] = [];
    }
    run_context.param_history[param].push({
      trial: ado_result.trial_index,
      mean: ado_result.post_mean[param],
      sd: ado_result.post_sd ? (ado_result.post_sd[param] || 0) : 0,
    });
  }
}

function sumFiniteDebugValues(values) {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (hasFiniteDebugValue(value)) {
      total += value;
      count += 1;
    }
  }
  return count ? total : null;
}

function appendInformationGainHistory(run_context, rows, ado_result) {
  if (!run_context.debug) {
    return;
  }
  if (!run_context.information_gain_history) {
    run_context.information_gain_history = {
      selected_design_mi: [],
      realized_information_gain: [],
    };
  }

  const row_list = Array.isArray(rows) ? rows : [rows];
  const selected_design_mi = sumFiniteDebugValues(row_list.map(row => row && row.ado_mutual_info));
  run_context.information_gain_history.selected_design_mi.push(selected_design_mi);
  run_context.information_gain_history.realized_information_gain.push(
    hasFiniteDebugValue(ado_result.realized_information_gain)
      ? ado_result.realized_information_gain
      : null
  );
}

function updateInformationGainPanel(run_context) {
  if (!run_context.debug || !run_context.information_gain_history) {
    return;
  }
  updateInfoGainDebugPanel(
    run_context.information_gain_history.selected_design_mi,
    run_context.information_gain_history.realized_information_gain
  );
}

function removeAdoDebugPanels() {
  const posterior_chart = typeof document !== "undefined"
    ? document.getElementById("ado-live-posterior-chart")
    : null;
  if (posterior_chart) {
    posterior_chart.remove();
  }
  removeInfoGainDebugPanel();
}

// ---------------------------------------------------------------------------
// Response-trial factories (the stimulus seam)
// ---------------------------------------------------------------------------
//
// A task's presentation builds its choice trials from these. Each factory that
// COLLECTS a response marks its trial with __ado_is_response and stores the raw
// response index on data.__ado_response; the timeline then composes the ADO
// finalize step (outcome mapping, design recording, posterior copy) on top.

// jsPsych plugin classes the timeline builds trials from. Bundler/ESM consumers
// can't rely on the plugins' UMD <script> globals, so they pass the classes via
// createTimeline(..., { plugins: { htmlButtonResponse, callFunction,
// canvasKeyboardResponse } }); static pages that load the UMD builds get them from
// globalThis as a fallback. (#57 bundler story.)
const PLUGIN_GLOBALS = {
  htmlButtonResponse: "jsPsychHtmlButtonResponse",
  callFunction: "jsPsychCallFunction",
  canvasKeyboardResponse: "jsPsychCanvasKeyboardResponse",
};

function resolvePlugin(plugins, key) {
  const injected = plugins && plugins[key];
  if (injected) {
    return injected;
  }
  return typeof globalThis !== "undefined" ? globalThis[PLUGIN_GLOBALS[key]] : undefined;
}

function requirePlugin(plugins, key) {
  const plugin = resolvePlugin(plugins, key);
  if (!plugin) {
    throw new Error(
      `createAdoTimeline: jsPsych plugin "${PLUGIN_GLOBALS[key]}" is not available. ` +
      `Load its UMD <script> build (which sets globalThis.${PLUGIN_GLOBALS[key]}), or ` +
      `pass it when bundling via createTimeline(..., { plugins: { ${key}: <PluginClass> } }).`
    );
  }
  return plugin;
}

/**
 * Single html-button-response choice trial. Covers the common case (e.g. delay
 * discounting's two option cards). Design-dependent rendering is lazy: stimulus,
 * button_html, data, and simulation_options all read ctx.getDesign() at run time,
 * so the live ADO-selected design is shown.
 *
 * @param {Object} ctx - { getDesign, getState, choices, run_context, trial_number, task, plugins? }
 * @param {Object} presentation - { makeStimulus, button_html?, keymap?, prompt?,
 *                                   margin_vertical?, margin_horizontal? }
 * @param {Object} [plugins] - Injected jsPsych plugin classes; defaults to ctx.plugins
 *   (then globalThis). See PLUGIN_GLOBALS.
 * @returns {Object} jsPsych html-button-response trial (response-collecting).
 */
function htmlButtonChoice(ctx, presentation, plugins = ctx && ctx.plugins) {
  let key_handler = null;

  const trial = {
    type: requirePlugin(plugins, "htmlButtonResponse"),
    stimulus: function() {
      return presentation.makeStimulus(ctx.getDesign());
    },
    choices: ctx.choices,
    margin_vertical: presentation.margin_vertical ?? "0px",
    margin_horizontal: presentation.margin_horizontal ?? "12px",
    simulation_options: function() {
      return makeChoiceSimulationOptions(ctx.run_context, ctx.getDesign());
    },
    data: function() {
      const state = ctx.getState();
      return {
        task: ctx.task,
        ado_session_id: state.session_id,
        ado_trial_index: state.trial_index,
        trial_number: ctx.trial_number,
        ...ctx.getDesign(),
      };
    },
    on_finish: function(data) {
      if (key_handler) {
        document.removeEventListener("keydown", key_handler);
        key_handler = null;
      }
      data.__ado_response = data.response;
    },
    __ado_is_response: true,
  };

  if (presentation.button_html) {
    trial.button_html = function() {
      return presentation.button_html(ctx.getDesign());
    };
  }
  if (presentation.prompt != null) {
    trial.prompt = presentation.prompt;
  }
  if (presentation.keymap) {
    // Map physical keys to button indices, then click the matching button so the
    // plugin records the response exactly as a mouse click would.
    const keymap = {};
    for (const [key, index] of Object.entries(presentation.keymap)) {
      keymap[key.toUpperCase()] = index;
    }
    trial.on_load = function() {
      key_handler = function(e) {
        const index = keymap[e.key.toUpperCase()];
        if (index === undefined) {
          return;
        }
        const btn = document.querySelector("#jspsych-html-button-response-button-" + index);
        if (btn) { btn.click(); }
      };
      document.addEventListener("keydown", key_handler);
    };
  }

  return trial;
}

/**
 * A canvas frame that shows a stimulus for a fixed duration and collects NO
 * response (e.g. a fixation cross or a brief stimulus flash). Forward-declared
 * for canvas tasks such as numerosity dots; not exercised by html-button models.
 *
 * @param {Object} opts
 * @param {Function} opts.draw - (canvas, design) => void; draws onto the canvas.
 * @param {Function} opts.getDesign - () => current design.
 * @param {?number} [opts.duration] - Frame duration in ms (with choices "NO_KEYS"
 *   a null duration would never end, so pass a duration for timed frames).
 * @param {Object} [plugins] - Injected jsPsych plugin classes (pass ctx.plugins);
 *   falls back to globalThis. See PLUGIN_GLOBALS.
 * @returns {Object} jsPsych canvas-keyboard-response trial (no response).
 */
function canvasFrame({ draw, getDesign, duration = null }, plugins) {
  return {
    type: requirePlugin(plugins, "canvasKeyboardResponse"),
    stimulus: function(canvas) {
      draw(canvas, getDesign());
    },
    choices: "NO_KEYS",
    trial_duration: duration,
    response_ends_trial: false,
  };
}

/**
 * A response-collecting canvas frame (keyboard). Forward-declared for canvas
 * tasks such as numerosity dots. The pressed key is mapped to a response index
 * via choices order, stored on data.__ado_response, and the trial is marked so
 * the timeline composes the ADO finalize step.
 *
 * @param {Object} opts
 * @param {Function} opts.draw - (canvas, design) => void.
 * @param {Function} opts.getDesign - () => current design.
 * @param {string[]} opts.choices - Response keys in index order, e.g. ["b","y"].
 * @param {Object} ctx - { getState, run_context, trial_number, task, plugins? }.
 * @param {Object} [plugins] - Injected jsPsych plugin classes; defaults to ctx.plugins
 *   (then globalThis). See PLUGIN_GLOBALS.
 * @returns {Object} jsPsych canvas-keyboard-response trial (response-collecting).
 */
function canvasResponse({ draw, getDesign, choices }, ctx, plugins = ctx && ctx.plugins) {
  const lower_choices = choices.map(key => String(key).toLowerCase());
  return {
    type: requirePlugin(plugins, "canvasKeyboardResponse"),
    stimulus: function(canvas) {
      draw(canvas, getDesign());
    },
    choices,
    simulation_options: function() {
      return makeChoiceSimulationOptions(ctx.run_context, getDesign());
    },
    data: function() {
      const state = ctx.getState();
      return {
        task: ctx.task,
        ado_session_id: state.session_id,
        ado_trial_index: state.trial_index,
        trial_number: ctx.trial_number,
        ...getDesign(),
      };
    },
    on_finish: function(data) {
      // Map the recorded key to its index. In jsPsych simulation, response may
      // already be an index; tolerate both.
      if (typeof data.response === "number") {
        data.__ado_response = data.response;
      } else {
        data.__ado_response = lower_choices.indexOf(String(data.response).toLowerCase());
      }
    },
    __ado_is_response: true,
  };
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
  if (!presentation || (typeof presentation.getChoiceTrials !== "function" && typeof presentation.makeStimulus !== "function")) {
    throw new Error("createAdoTimeline: config.presentation must provide getChoiceTrials or makeStimulus.");
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
      "<p style=\"color: #9ca3af; font-size: 0.85rem;\">" + message + "</p>"
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
    func: function(done) {
      adaptive_controller.start(run_context).then(result => {
        ado_state = result;
        if (testlet_size > 1 && !result.next_designs) {
          return failExperiment(
            new Error("Adaptive controller did not return next_designs; testlet_size > 1 requires a batch-aware controller."),
            done
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
      }).catch(error => failExperiment(error, done));
    }
  };

  const trials = [initialize_ado];

  for (let i = 0; i < config.n_trials; i++) {
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

    const choice_trials = typeof presentation.getChoiceTrials === "function"
      ? presentation.getChoiceTrials(ctx)
      : [htmlButtonChoice(ctx, presentation, injected_plugins)];

    const response_trials = choice_trials.filter(t => t && t.__ado_is_response);
    if (response_trials.length !== 1) {
      throw new Error(
        `createAdoTimeline: a choice must contain exactly one response-collecting trial ` +
        `(built via htmlButtonChoice/canvasResponse); got ${response_trials.length}.`
      );
    }

    const first_trial = choice_trials[0];
    const inner_on_start = first_trial.on_start;
    first_trial.on_start = function(trial) {
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
    response_trial.on_finish = function(data) {
      if (inner_on_finish) {
        inner_on_finish.call(this, data);
      }
      copySimulationAuditFields(data, run_context);
      const design = current_design;
      const choice_raw = data.__ado_response;
      const choice = responseToOutcome(design, choice_raw);
      data.choice_raw = choice_raw;
      data.choice = choice;
      data.choice_label = config.response_labels[choice];
      data.ado_design = { ...design };
      data.testlet_index = Math.floor(i / testlet_size);
      data.testlet_position = i % testlet_size;
      copyPosteriorFields(data, ado_state);
      copySelectionFields(data, ado_state, current_design_metric);
      testlet_rows.push(data);
    };

    trials.push(...choice_trials);

    const at_boundary = ((i + 1) % testlet_size === 0) || (i + 1 === config.n_trials);
    if (at_boundary) {
      trials.push({
        type: callFunctionPlugin,
        async: true,
        func: function(done) {
          const batch = testlet_rows.slice();
          testlet_rows.length = 0;
          const payload = testlet_size === 1 ? batch[0] : batch;
          adaptive_controller.update(payload).then(result => {
            ado_state = result;
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
            });
          }).catch(error => failExperiment(error, done));
        },
        on_finish: function() {
          updateLiveCharts(run_context.param_history || {}, ado_state, run_context);
          updateInformationGainPanel(run_context);
        }
      });
    }
  }

  return trials;
}

export {
  createAdoTimeline,
  htmlButtonChoice,
  canvasFrame,
  canvasResponse,
  getParamAxisDomain,
  makeParamConvergenceSvg,
  makeDebriefStimulus,
  removeAdoDebugPanels,
};
