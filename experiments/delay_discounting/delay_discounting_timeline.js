/**
 * @typedef {Object} DelayDiscountingDesign
 * @property {number} r_ss - Smaller-sooner reward.
 * @property {number} t_ss - Smaller-sooner delay.
 * @property {number} r_ll - Larger-later reward.
 * @property {number} t_ll - Larger-later delay.
 */

/**
 * @typedef {Object} DelayDiscountingPosteriorSummary
 * @property {number} k - Posterior summary for discount rate.
 * @property {number} tau - Posterior summary for choice sensitivity.
 */

/**
 * @typedef {Object} DelayDiscountingAdoState
 * @property {string} session_id - Backend/controller session identifier.
 * @property {number} trial_index - Zero-based ADO trial index for next_design.
 * @property {DelayDiscountingDesign} next_design - Design to show on the next choice trial.
 * @property {?DelayDiscountingPosteriorSummary} post_mean - Posterior means after the latest update.
 * @property {?DelayDiscountingPosteriorSummary} post_sd - Posterior SDs after the latest update.
 * @property {?number} api_latency_ms - API round-trip time when available.
 */

/**
 * @typedef {Object} DelayDiscountingAdoController
 * @property {Function} start - Async function(context) returning initial DelayDiscountingAdoState.
 * @property {Function} update - Async function(trial_data) returning updated DelayDiscountingAdoState.
 */

/**
 * @typedef {Object} DelayDiscountingRunContext
 * @property {string} ado_mode - Controller mode label saved into data/debug logs.
 * @property {boolean} debug - Whether to print ADO trial summaries.
 * @property {?string} simulation_mode - jsPsych simulation mode, usually data-only or visual.
 * @property {?Function} simulate_choice - Function(design) returning simulated jsPsych trial data.
 * @property {?Object} param_history - Mutable posterior history for debug charts.
 * @property {?Object} posterior_display - Optional parameter labels and preferred chart ranges.
 */

function formatDelay(delay) {
  if (delay === 0) {
    return "now";
  }
  if (delay === 1) {
    return "1 week";
  }
  if (delay < 1) {
    return `${delay} weeks`;
  }
  return `${delay} weeks`;
}

function formatReward(reward) {
  return `$${Number(reward).toFixed(2).replace(".00", "")}`;
}

/**
 * Build the HTML shown for one delay-discounting choice trial.
 *
 * @param {DelayDiscountingDesign} design - Current SS/LL offer.
 * @returns {string} HTML stimulus for jsPsychHtmlButtonResponse.
 */
function makeChoiceStimulus(design) {
  return `<p style="font-size: 1.3rem; margin: 0 0 1.75rem;">Which would you prefer?</p>`;
}

function makeOptionCardHtml(design, index) {
  var is_ss = index === 0;
  var amount = is_ss ? design.r_ss : design.r_ll;
  var delay = is_ss ? design.t_ss : design.t_ll;
  var key_hint = is_ss ? "S" : "L";
  var delay_text = delay === 0 ? "available now" : "available in " + formatDelay(delay);
  return "<button class=\"dd-option-card\">"
    + "<span class=\"dd-key-hint\">" + key_hint + "</span>"
    + "<span class=\"dd-amount\">" + formatReward(amount) + "</span>"
    + "<span class=\"dd-when\">" + delay_text + "</span>"
    + "</button>";
}

/**
 * Copy posterior summaries from the current ADO state onto a jsPsych choice row.
 *
 * This is the data boundary for posterior fields that later recovery/validation
 * code can read from the saved jsPsych JSON.
 *
 * @param {Object} data - jsPsych choice-trial data row, mutated in place.
 * @param {DelayDiscountingAdoState} ado_state - Current controller state.
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
  return `${value} ms`;
}

function formatDebugOffer(label, reward, delay) {
  const delay_label = formatDelay(delay);
  const delay_text = delay_label === "now" ? delay_label : `in ${delay_label}`;
  return `${label}: ${formatReward(reward)} ${delay_text}`;
}

/**
 * Print a readable summary of the just-finished ADO update.
 *
 * @param {DelayDiscountingRunContext} run_context - Current run settings.
 * @param {Object} trial_data - Completed jsPsych choice row.
 * @param {DelayDiscountingAdoState} ado_result - Updated controller state.
 * @param {Object} config - Delay-discounting experiment config.
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
    const label = `ADO update ${trial_data.trial_number}/${total_trials} | ${run_context.ado_mode} | response: ${trial_data.choice_label}`;
    const summary = [
      `${label} | latency: ${formatDebugLatency(ado_result.api_latency_ms)}`,
      "",
      "Presented:",
      `  ${formatDebugOffer("SS", trial_data.r_ss, trial_data.t_ss)}`,
      `  ${formatDebugOffer("LL", trial_data.r_ll, trial_data.t_ll)}`,
      "",
      "Posterior after response:",
      ...Object.keys(post_mean).map(param =>
        `  ${param}: mean ${formatDebugNumber(post_mean[param])}, sd ${formatDebugNumber(post_sd[param])}`
      ),
      "",
      // next_design is null on the final update (no further trial to show it on).
      next_design
        ? [
            "Next ADO design:",
            `  ${formatDebugOffer("SS", next_design.r_ss, next_design.t_ss)}`,
            `  ${formatDebugOffer("LL", next_design.r_ll, next_design.t_ll)}`,
          ].join("\n")
        : "Next ADO design: (final trial; none)",
    ].join("\n");

    console.log(summary);

    if (console.groupCollapsed && console.table && console.groupEnd) {
      console.groupCollapsed(`${label} details`);
      const offer_rows = [
        { option: "Presented SS", reward: trial_data.r_ss, delay: trial_data.t_ss },
        { option: "Presented LL", reward: trial_data.r_ll, delay: trial_data.t_ll },
      ];
      if (next_design) {
        offer_rows.push(
          { option: "Next SS", reward: next_design.r_ss, delay: next_design.t_ss },
          { option: "Next LL", reward: next_design.r_ll, delay: next_design.t_ll },
        );
      }
      console.table(offer_rows);
      console.table(Object.keys(post_mean).map(param => ({
        parameter: param,
        mean: post_mean[param],
        sd: post_sd[param],
      })));
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
 * @param {DelayDiscountingRunContext} run_context - Current run settings.
 * @param {DelayDiscountingDesign} design - Current SS/LL offer.
 * @returns {Object} jsPsych simulation_options object for the choice trial.
 */
function makeChoiceSimulationOptions(run_context, design) {
  if (!run_context.simulation_mode || !run_context.simulate_choice) {
    return {};
  }

  return {
    data: run_context.simulate_choice(design),
  };
}

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

/**
 * Render a parameter posterior trajectory (mean ± SD per trial) as an SVG string.
 *
 * When y_min/y_max are provided, they are treated as preferred display ranges.
 * If the posterior mean ± SD exceeds those ranges, the axis expands and the
 * chart notes that expansion instead of silently clipping values.
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

  var data_min = Infinity, data_max = -Infinity;
  series.forEach(function(d) {
    data_min = Math.min(data_min, d.mean - (d.sd || 0));
    data_max = Math.max(data_max, d.mean + (d.sd || 0));
  });

  var has_preferred_range = typeof opts.y_min === "number" && typeof opts.y_max === "number";
  var has_lower_bound = typeof opts.lower_bound === "number";
  var bounded_data_min = has_lower_bound ? Math.max(opts.lower_bound, data_min) : data_min;
  var axis_expanded = false;
  var axis_bounded = false;
  var y_min, y_max;
  if (has_preferred_range) {
    y_min = Math.min(opts.y_min, bounded_data_min);
    if (has_lower_bound) {
      y_min = Math.max(opts.lower_bound, y_min);
      axis_bounded = data_min < opts.lower_bound;
    }
    y_max = Math.max(opts.y_max, data_max);
    axis_expanded = y_min < opts.y_min || y_max > opts.y_max;
  } else {
    y_min = bounded_data_min;
    y_max = data_max;
    var y_pad = (y_max - y_min) * 0.10 || 0.001;
    y_min -= y_pad; y_max += y_pad;
    if (has_lower_bound) {
      y_min = Math.max(opts.lower_bound, y_min);
      axis_bounded = data_min < opts.lower_bound;
    }
  }
  if (y_min === y_max) {
    y_min -= 0.001;
    y_max += 0.001;
  }

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
  if (axis_expanded) {
    axis_notes.push("axis expanded");
  }
  if (axis_bounded) {
    axis_notes.push("lower bound");
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
 * @param {DelayDiscountingAdoState} ado_state
 * @param {DelayDiscountingRunContext} run_context
 */
function updateLiveCharts(param_history, ado_state, run_context) {
  if (!run_context.debug) {
    return;
  }

  var params = Object.keys(param_history);
  if (params.length === 0) {
    return;
  }

  var container = document.getElementById("dd-live-posterior-chart");
  if (!container) {
    container = document.createElement("div");
    container.id = "dd-live-posterior-chart";
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

/**
 * Create the adaptive delay-discounting jsPsych timeline fragment.
 *
 * The timeline depends only on the ADO controller contract: start() provides the
 * first design, and update(trial_data) returns posterior summaries plus the next
 * design. This keeps the jsPsych task independent of whether the controller is
 * mock-backed or the live in-browser Stan controller.
 *
 * @param {Object} jsPsych - jsPsych instance returned by initJsPsych().
 * @param {DelayDiscountingAdoController} adaptive_controller - Controller with start/update methods.
 * @param {Object} config - Delay-discounting config with n_trials and response_labels.
 * @param {DelayDiscountingRunContext} run_context - Run settings and optional simulation hook.
 * @returns {Array} jsPsych timeline fragment.
 */
function createDelayDiscountingTimeline(jsPsych, adaptive_controller, config, run_context = {}) {
  let ado_state = null;
  let current_design = null;
  let last_choice_data = null;
  let active_key_handler = null;

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

  const initialize_ado = {
    type: jsPsychCallFunction,
    async: true,
    func: function(done) {
      adaptive_controller.start(run_context).then(result => {
        ado_state = result;
        current_design = result.next_design;
        done({
          ado_event: "start",
          ado_session_id: result.session_id,
          ado_trial_index: result.trial_index,
          ado_mode: run_context.ado_mode,
        });
      }).catch(error => failExperiment(error, done));
    }
  };

  const trials = [initialize_ado];

  for (let i = 0; i < config.n_trials; i++) {
    trials.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: function() {
        return makeChoiceStimulus(current_design);
      },
      choices: ["SS", "LL"],
      button_html: function() {
        return [
          makeOptionCardHtml(current_design, 0),
          makeOptionCardHtml(current_design, 1),
        ];
      },
      margin_vertical: "0px",
      margin_horizontal: "12px",
      prompt: "<p style=\"margin-top: 1.25rem; font-size: 0.82rem; color: #9ca3af;\">Press <strong>S</strong> for Smaller-sooner &nbsp;·&nbsp; Press <strong>L</strong> for Larger-later</p>",
      simulation_options: function() {
        return makeChoiceSimulationOptions(run_context, current_design);
      },
      data: function() {
        return {
          task: "delay_discounting",
          ado_session_id: ado_state.session_id,
          ado_trial_index: ado_state.trial_index,
          trial_number: i + 1,
          t_ss: current_design.t_ss,
          t_ll: current_design.t_ll,
          r_ss: current_design.r_ss,
          r_ll: current_design.r_ll,
        };
      },
      on_load: function() {
        active_key_handler = function(e) {
          var key = e.key.toUpperCase();
          if (key === "S") {
            var btn = document.querySelector("#jspsych-html-button-response-button-0");
            if (btn) { btn.click(); }
          } else if (key === "L") {
            var btn = document.querySelector("#jspsych-html-button-response-button-1");
            if (btn) { btn.click(); }
          }
        };
        document.addEventListener("keydown", active_key_handler);
      },
      on_finish: function(data) {
        if (active_key_handler) {
          document.removeEventListener("keydown", active_key_handler);
          active_key_handler = null;
        }
        data.choice = data.response;
        data.choice_label = config.response_labels[data.choice];
        data.ado_design = {
          t_ss: data.t_ss,
          t_ll: data.t_ll,
          r_ss: data.r_ss,
          r_ll: data.r_ll,
        };
        copyPosteriorFields(data, ado_state);
        last_choice_data = data;
      }
    });

    trials.push({
      type: jsPsychCallFunction,
      async: true,
      func: function(done) {
        adaptive_controller.update(last_choice_data).then(result => {
          ado_state = result;
          current_design = result.next_design;
          logAdoTrial(run_context, last_choice_data, result, config);
          appendPosteriorHistory(run_context, result);
          done({
            ado_event: "update",
            ado_session_id: result.session_id,
            ado_trial_index: result.trial_index,
            ado_next_design: result.next_design,
            ado_post_mean: result.post_mean,
            ado_post_sd: result.post_sd,
            ado_api_latency_ms: result.api_latency_ms,
          });
        }).catch(error => failExperiment(error, done));
      },
      on_finish: function() {
        updateLiveCharts(run_context.param_history || {}, ado_state, run_context);
      }
    });
  }

  return trials;
}

export { createDelayDiscountingTimeline, makeChoiceStimulus, makeParamConvergenceSvg, makeDebriefStimulus };
