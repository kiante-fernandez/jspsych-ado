// Response-trial factories — the stimulus seam between a task's presentation and the
// generic ADO timeline (MODEL- AND STIMULUS-AGNOSTIC).
//
// A task's presentation builds its choice trials from these. Each factory that
// COLLECTS a response marks its trial with __ado_is_response and stores the raw
// response on data.__ado_response (a choice index for discrete tasks, a slider value
// for continuous tasks); the timeline then composes the ADO finalize step (outcome
// mapping, design recording, posterior copy) on top. The simulation helpers route a
// simulated participant's response into the trial and audit-copy its sim_* fields.

// jsPsych plugin classes the timeline builds trials from. Bundler/ESM consumers
// can't rely on the plugins' UMD <script> globals, so they pass the classes via
// createTimeline(..., { plugins: { htmlButtonResponse, callFunction,
// canvasKeyboardResponse } }); static pages that load the UMD builds get them from
// globalThis as a fallback. (#57 bundler story.)
const PLUGIN_GLOBALS = {
  htmlButtonResponse: "jsPsychHtmlButtonResponse",
  callFunction: "jsPsychCallFunction",
  canvasKeyboardResponse: "jsPsychCanvasKeyboardResponse",
  canvasSliderResponse: "jsPsychCanvasSliderResponse",
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
        `pass it when bundling via createTimeline(..., { plugins: { ${key}: <PluginClass> } }).`,
    );
  }
  return plugin;
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
    if (key.startsWith("sim_") && data[key] === undefined) {
      data[key] = value;
    }
  }
  run_context.pending_simulation_data = null;
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
    stimulus: function () {
      return presentation.makeStimulus(ctx.getDesign());
    },
    choices: ctx.choices,
    margin_vertical: presentation.margin_vertical ?? "0px",
    margin_horizontal: presentation.margin_horizontal ?? "12px",
    simulation_options: function () {
      return makeChoiceSimulationOptions(ctx.run_context, ctx.getDesign());
    },
    data: function () {
      const state = ctx.getState();
      return {
        task: ctx.task,
        ado_session_id: state.session_id,
        ado_trial_index: state.trial_index,
        trial_number: ctx.trial_number,
        ...ctx.getDesign(),
      };
    },
    on_finish: function (data) {
      if (key_handler) {
        document.removeEventListener("keydown", key_handler);
        key_handler = null;
      }
      data.__ado_response = data.response;
    },
    __ado_is_response: true,
  };

  if (presentation.button_html) {
    trial.button_html = function () {
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
    trial.on_load = function () {
      key_handler = function (e) {
        const index = keymap[e.key.toUpperCase()];
        if (index === undefined) {
          return;
        }
        // jsPsych v8 / plugin-html-button-response v2 renders buttons as
        // `#...-btngroup [data-choice="N"]`; v7 used `#...-button-N`. Try the v8
        // selector first and fall back to v7 so keyboard shortcuts work on both. (#5)
        const btn =
          document.querySelector(
            '#jspsych-html-button-response-btngroup [data-choice="' + index + '"]',
          ) || document.querySelector("#jspsych-html-button-response-button-" + index);
        if (btn) {
          btn.click();
        }
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
    stimulus: function (canvas) {
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
  const lower_choices = choices.map((key) => String(key).toLowerCase());
  return {
    type: requirePlugin(plugins, "canvasKeyboardResponse"),
    stimulus: function (canvas) {
      draw(canvas, getDesign());
    },
    choices,
    simulation_options: function () {
      return makeChoiceSimulationOptions(ctx.run_context, getDesign());
    },
    data: function () {
      const state = ctx.getState();
      return {
        task: ctx.task,
        ado_session_id: state.session_id,
        ado_trial_index: state.trial_index,
        trial_number: ctx.trial_number,
        ...getDesign(),
      };
    },
    on_finish: function (data) {
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

/**
 * A response-collecting canvas-slider trial: the CONTINUOUS-response counterpart to
 * canvasResponse. Draws a design-dependent stimulus and records the slider value as
 * the raw response on data.__ado_response (a real number). A continuous task's
 * responseToOutcome typically maps that raw value into the modeled response (e.g.
 * log(estimate) for a power-law model); with the default identity it passes through.
 *
 * @param {Object} opts
 * @param {Function} opts.draw - (canvas, design) => void.
 * @param {Function} opts.getDesign - () => current design.
 * @param {number} [opts.min=0] - Slider minimum.
 * @param {number} [opts.max=100] - Slider maximum.
 * @param {number} [opts.step=1] - Slider step.
 * @param {?number} [opts.slider_start] - Initial slider position (defaults to the midpoint).
 * @param {string[]} [opts.labels] - Tick labels under the slider.
 * @param {string} [opts.prompt] - HTML shown with the slider.
 * @param {boolean} [opts.require_movement=false] - Require the slider to move before continuing.
 * @param {Array<number>} [opts.canvas_size] - [height, width] passed to the plugin.
 * @param {Object} ctx - { getState, run_context, trial_number, task, plugins? }.
 * @param {Object} [plugins] - Injected jsPsych plugin classes; defaults to ctx.plugins (then globalThis).
 * @returns {Object} jsPsych canvas-slider-response trial (response-collecting).
 */
function canvasSliderChoice(
  {
    draw,
    getDesign,
    min = 0,
    max = 100,
    step = 1,
    slider_start = null,
    labels,
    prompt,
    require_movement = false,
    canvas_size,
  },
  ctx,
  plugins = ctx && ctx.plugins,
) {
  const trial = {
    type: requirePlugin(plugins, "canvasSliderResponse"),
    stimulus: function (canvas) {
      draw(canvas, getDesign());
    },
    min,
    max,
    step,
    slider_start: slider_start != null ? slider_start : (min + max) / 2,
    require_movement,
    simulation_options: function () {
      return makeChoiceSimulationOptions(ctx.run_context, getDesign());
    },
    data: function () {
      const state = ctx.getState();
      return {
        task: ctx.task,
        ado_session_id: state.session_id,
        ado_trial_index: state.trial_index,
        trial_number: ctx.trial_number,
        ...getDesign(),
      };
    },
    on_finish: function (data) {
      data.__ado_response = data.response; // raw slider value (continuous)
    },
    __ado_is_response: true,
  };
  if (labels) {
    trial.labels = labels;
  }
  if (prompt != null) {
    trial.prompt = prompt;
  }
  if (canvas_size) {
    trial.canvas_size = canvas_size;
  }
  return trial;
}

export {
  requirePlugin,
  copySimulationAuditFields,
  htmlButtonChoice,
  canvasFrame,
  canvasResponse,
  canvasSliderChoice,
};
