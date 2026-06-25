import { updateInfoGainDebugPanel, removeInfoGainDebugPanel } from "./debug_trace_charts.js";

// Live posterior-convergence visualization for the ADO timeline (DEBUG ONLY,
// model-agnostic). Renders per-parameter mean ± SD trajectories as inline SVG:
//   - a fixed bottom bar updated each trial (updateLiveCharts),
//   - a full-size debrief block for the finish page (makeDebriefStimulus),
//   - the information-gain trace panel (appendInformationGainHistory + the panel),
// plus the running histories the charts draw from. None of this is shown to real
// participants; everything is gated on run_context.debug by the timeline.

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

  var data_lo = Infinity,
    data_hi = -Infinity;
  series.forEach(function (d) {
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
  var has_preferred_range =
    isFiniteNumber(opts.y_min) && isFiniteNumber(opts.y_max) && opts.y_min < opts.y_max;
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
      var bounded_center = has_data
        ? Math.min(
            opts.upper_bound - fallback_span / 2,
            Math.max(opts.lower_bound + fallback_span / 2, data_lo),
          )
        : (opts.lower_bound + opts.upper_bound) / 2;
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
  var W = opts.width || 500,
    H = opts.height || 200;
  var ml = 44,
    mr = 12,
    mt = 12,
    mb = 34;
  var pw = W - ml - mr;
  var ph = H - mt - mb;
  var n = series.length;

  if (n === 0) {
    return (
      '<svg width="' +
      W +
      '" height="' +
      H +
      '"><text x="' +
      W / 2 +
      '" y="' +
      H / 2 +
      '" text-anchor="middle" font-size="12" fill="#6b7280">No data yet</text></svg>'
    );
  }

  var axis = getParamAxisDomain(series, opts);
  var y_min = axis.y_min;
  var y_max = axis.y_max;

  function sx(i) {
    return ml + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  }
  function sy(v) {
    if (v < y_min) {
      v = y_min;
    }
    if (v > y_max) {
      v = y_max;
    }
    return mt + ph - ((v - y_min) / (y_max - y_min)) * ph;
  }

  var band_top = [],
    band_bot = [];
  series.forEach(function (d, i) {
    band_top.push(sx(i) + "," + sy(d.mean + (d.sd || 0)));
    band_bot.unshift(sx(i) + "," + sy(d.mean - (d.sd || 0)));
  });
  var band_pts = band_top.concat(band_bot).join(" ");
  var line_pts = series
    .map(function (d, i) {
      return sx(i) + "," + sy(d.mean);
    })
    .join(" ");

  var y_ticks = "";
  for (var t = 0; t <= 3; t++) {
    var v = y_min + (y_max - y_min) * (t / 3);
    var yp = sy(v);
    y_ticks +=
      '<line x1="' +
      ml +
      '" y1="' +
      yp +
      '" x2="' +
      (ml + pw) +
      '" y2="' +
      yp +
      '" stroke="#e5e7eb" stroke-width="1"/>' +
      '<text x="' +
      (ml - 4) +
      '" y="' +
      (yp + 4) +
      '" text-anchor="end" font-size="9" fill="#6b7280">' +
      formatAxisTick(v) +
      "</text>";
  }

  var x_ticks = "";
  var tick_indices = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  tick_indices.forEach(function (i) {
    x_ticks +=
      '<text x="' +
      sx(i) +
      '" y="' +
      (mt + ph + 16) +
      '" text-anchor="middle" font-size="9" fill="#6b7280">' +
      series[i].trial +
      "</text>";
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
    ? '<text x="' +
      (ml + pw) +
      '" y="' +
      (mt + 10) +
      '" text-anchor="end" font-size="9" fill="#b45309">' +
      axis_notes.join("; ") +
      "</text>"
    : "";

  return (
    '<svg width="' +
    W +
    '" height="' +
    H +
    '" style="display:block;">' +
    '<rect x="' +
    ml +
    '" y="' +
    mt +
    '" width="' +
    pw +
    '" height="' +
    ph +
    '" fill="#f9fafb" stroke="#e5e7eb" stroke-width="1"/>' +
    y_ticks +
    axis_note +
    '<polygon points="' +
    band_pts +
    '" fill="rgba(99,102,241,0.15)"/>' +
    '<polyline points="' +
    line_pts +
    '" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linejoin="round"/>' +
    x_ticks +
    '<text x="' +
    (ml + pw / 2) +
    '" y="' +
    (H - 4) +
    '" text-anchor="middle" font-size="10" fill="#374151">Trial</text>' +
    '<text x="10" y="' +
    (mt + ph / 2) +
    '" text-anchor="middle" font-size="10" fill="#374151" transform="rotate(-90 10 ' +
    (mt + ph / 2) +
    ')">' +
    param_label +
    "</text>" +
    "</svg>"
  );
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
    container.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,0.95);border-top:1px solid #e5e7eb;z-index:1000;pointer-events:none;padding:0.3rem 0;";
    document.body.appendChild(container);
  }

  var header =
    '<div style="text-align:center;font-size:0.7rem;color:#9ca3af;margin-bottom:0.1rem;">Running posterior [debug]</div>';
  var charts_html = '<div style="display:flex;justify-content:center;gap:0.75rem;">';
  params.forEach(function (param) {
    var display = getParamDisplay(param, run_context.posterior_display);
    var label = display.label || param;
    charts_html +=
      '<div style="text-align:center;">' +
      '<div style="font-size:0.7rem;color:#6b7280;margin-bottom:2px;">' +
      label +
      "</div>" +
      makeParamConvergenceSvg(param_history[param], param, {
        width: 280,
        height: 150,
        label: label,
        y_min: display.y_min,
        y_max: display.y_max,
        lower_bound: display.lower_bound,
        upper_bound: display.upper_bound,
        min_y_span: display.min_y_span,
      }) +
      "</div>";
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
  var last_values = params
    .map(function (param) {
      var series = param_history[param];
      if (!series.length) {
        return "";
      }
      var last = series[series.length - 1];
      var display = getParamDisplay(param, posterior_display);
      var label = display.label || param;
      return (
        '<p style="margin:0.25rem 0;font-size:0.9rem;color:#374151;">' +
        "<strong>" +
        label +
        "</strong>: " +
        last.mean.toPrecision(3) +
        " ± " +
        last.sd.toPrecision(2) +
        "</p>"
      );
    })
    .join("");
  var charts =
    '<div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;margin-top:0.75rem;">' +
    params
      .map(function (param) {
        var display = getParamDisplay(param, posterior_display);
        var label = display.label || param;
        return (
          '<div style="text-align:center;">' +
          '<div style="font-size:0.8rem;color:#6b7280;margin-bottom:4px;">' +
          label +
          " posterior trajectory</div>" +
          makeParamConvergenceSvg(param_history[param], param, {
            width: 380,
            height: 220,
            label: label,
            y_min: display.y_min,
            y_max: display.y_max,
            lower_bound: display.lower_bound,
            upper_bound: display.upper_bound,
            min_y_span: display.min_y_span,
          }) +
          "</div>"
        );
      })
      .join("") +
    "</div>";
  return (
    "<h2>Finished</h2>" +
    '<p style="color:#6b7280;font-size:0.85rem;">Estimated parameters (posterior mean ± SD):</p>' +
    last_values +
    charts +
    '<p style="margin-top:1rem;">Click SUBMIT to finish.</p>'
  );
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
      sd: ado_result.post_sd ? ado_result.post_sd[param] || 0 : 0,
    });
  }
}

function hasFiniteDebugValue(value) {
  return typeof value === "number" && Number.isFinite(value);
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
  const selected_design_mi = sumFiniteDebugValues(
    row_list.map((row) => row && row.ado_mutual_info),
  );
  run_context.information_gain_history.selected_design_mi.push(selected_design_mi);
  run_context.information_gain_history.realized_information_gain.push(
    hasFiniteDebugValue(ado_result.realized_information_gain)
      ? ado_result.realized_information_gain
      : null,
  );
}

function updateInformationGainPanel(run_context) {
  if (!run_context.debug || !run_context.information_gain_history) {
    return;
  }
  updateInfoGainDebugPanel(
    run_context.information_gain_history.selected_design_mi,
    run_context.information_gain_history.realized_information_gain,
  );
}

function removeAdoDebugPanels() {
  const posterior_chart =
    typeof document !== "undefined" ? document.getElementById("ado-live-posterior-chart") : null;
  if (posterior_chart) {
    posterior_chart.remove();
  }
  removeInfoGainDebugPanel();
}

export {
  getParamAxisDomain,
  makeParamConvergenceSvg,
  updateLiveCharts,
  makeDebriefStimulus,
  appendPosteriorHistory,
  appendInformationGainHistory,
  updateInformationGainPanel,
  removeAdoDebugPanels,
};
