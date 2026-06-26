// Demo-only experiment scaffolding shared by every demo page (demos/*/index.html). NOT part
// of the published package: it consumes the public jsPsychADO façade plus a couple of
// internal modules via relative paths, which resolve only because the demo HTML sets
// <base href="../../">. It turns URL params into a run mode (controller/strategy/simulate/
// debug), resolves the simulated-participant config, builds the ADO run-context, and
// assembles the timeline (mock vs Stan). Your own experiment calls jsPsychADO.createTimeline
// directly (see demos/README.md) — none of this scaffolding is needed.

import { jsPsychADO } from "../../src/index.js";
import { createAdoTimeline } from "../../src/ado/ado_timeline.js";
import { createMockAdoController } from "../../src/controllers/mock_ado_controller.js";

const VALID_CONTROLLERS = ["mock", "stan"];
const VALID_STRATEGIES = ["ado", "random"];
const VALID_SIMULATION_MODES = ["data-only", "visual"];
const DEFAULT_VISUAL_SIMULATION_RT = {
  instructions: 700,
  choice: 1000,
  end: 600,
};

/**
 * Resolve the run mode from URL params: controller=stan|mock (default stan) and
 * strategy=ado|random (default ado; forced to null and ignored under controller=mock).
 * Returns the EFFECTIVE {controller_mode, design_strategy, ado_mode} that gets recorded in
 * the data — ado_mode is a derived label ("mock" | "random" | "stan"), not the raw URL value.
 *
 * @param {URLSearchParams} params
 * @returns {{controller_mode: string, design_strategy: ?string, ado_mode: string}}
 */
function getRunSelection(params) {
  const requested_controller = params.get("controller");
  const requested_strategy = params.get("strategy");

  let controller_mode = "stan";
  let design_strategy = "ado";

  if (requested_controller) {
    if (VALID_CONTROLLERS.includes(requested_controller)) {
      controller_mode = requested_controller;
    } else {
      console.warn(
        `Unknown controller "${requested_controller}"; using controller=${controller_mode}.`,
      );
    }
  }

  if (requested_strategy) {
    if (VALID_STRATEGIES.includes(requested_strategy)) {
      design_strategy = requested_strategy;
    } else {
      console.warn(
        `Unknown strategy "${requested_strategy}"; using strategy=${design_strategy || "none"}.`,
      );
    }
  }

  if (controller_mode === "mock") {
    if (requested_strategy) {
      console.warn("strategy= is ignored when controller=mock.");
    }
    design_strategy = null;
  }

  return {
    controller_mode,
    design_strategy,
    ado_mode:
      controller_mode === "mock"
        ? controller_mode
        : design_strategy === "random"
          ? "random"
          : "stan",
  };
}

/**
 * getRunSelection plus the debug flag (debug=1) and the simulate mode
 * (simulate=data-only|visual, else null).
 */
function getExperimentRunSettings(params) {
  const requested_simulation_mode = params.get("simulate");
  return {
    ...getRunSelection(params),
    debug: params.get("debug") === "1",
    simulation_mode: VALID_SIMULATION_MODES.includes(requested_simulation_mode)
      ? requested_simulation_mode
      : null,
  };
}

// Accept a run override either as an explicit `simulation` field OR as a bare
// {seed,params,rt} object passed directly — so callers can nest it or hand it in flat.
function getSimulationOverride(config) {
  if (config && config.simulation) {
    return config.simulation;
  }
  if (config && ("seed" in config || "params" in config || "rt" in config)) {
    return config;
  }
  return {};
}

function mergeSimulationConfig(default_config, override) {
  override = override || {};
  return {
    ...default_config,
    ...override,
    params: {
      ...default_config.params,
      ...(override.params || {}),
    },
    rt: {
      ...default_config.rt,
      ...(override.rt || {}),
    },
  };
}

function getSimulationModeDefaults(simulation_mode) {
  if (simulation_mode === "visual") {
    return {
      rt: DEFAULT_VISUAL_SIMULATION_RT,
    };
  }
  return {};
}

/**
 * Build the simulated-participant config by deep-merging three layers (lowest to highest
 * precedence): the demo's default_config, the simulate-mode defaults (e.g. visual RTs), then
 * any per-run override. `params` and `rt` are merged key-by-key.
 */
function resolveSimulationConfig(default_config, run_config, simulation_mode = null) {
  const mode_config = getSimulationModeDefaults(simulation_mode);
  const base_config = mergeSimulationConfig(default_config, mode_config);
  return mergeSimulationConfig(base_config, getSimulationOverride(run_config || {}));
}

/**
 * jsPsych simulation data for an N-page instructions trial: a per-page view_history at the
 * configured instruction RT, plus the total rt.
 */
function makeInstructionSimulationData(page_count, simulation_config) {
  let view_history = [];
  for (let i = 0; i < page_count; i++) {
    view_history.push({
      page_index: i,
      viewing_time: simulation_config.rt.instructions,
    });
  }

  return {
    rt: page_count * simulation_config.rt.instructions,
    view_history,
  };
}

function makeEndSimulationData(simulation_config) {
  return {
    response: 0,
    rt: simulation_config.rt.end,
  };
}

/**
 * Assemble the run_context the timeline threads through every trial: the run-mode labels,
 * the model's posterior_display, an empty param_history for the live debug charts, and the
 * simulate_choice hook (when simulating).
 */
function makeAdoRunContext({ run_settings, model, session_id, simulate_choice }) {
  return {
    ado_mode: run_settings.ado_mode,
    controller_mode: run_settings.controller_mode,
    design_strategy: run_settings.design_strategy,
    model_id: model.id,
    debug: run_settings.debug,
    param_history: {},
    posterior_display: model.posterior_display,
    simulation_mode: run_settings.simulation_mode,
    session_id,
    simulate_choice,
  };
}

/** Stamp run-mode + simulation metadata (including sim_<param> truth values) onto every jsPsych data row. */
function addAdoDataProperties(jsPsych, { run_settings, model, simulation_config }) {
  jsPsych.data.addProperties({
    ado_mode: run_settings.ado_mode,
    controller_mode: run_settings.controller_mode,
    design_strategy: run_settings.design_strategy,
    model_id: model.id,
    debug: run_settings.debug,
    simulate: run_settings.simulation_mode,
    simulation_seed: simulation_config.seed,
    ...Object.fromEntries(
      Object.entries(simulation_config.params).map(([name, value]) => ["sim_" + name, value]),
    ),
  });
}

/**
 * Demo convenience: register the task + model package in one call (wraps
 * jsPsychADO.registerTask + registerModelPackage). The bare two-call form an experiment
 * would actually write is documented in demos/README.md.
 */
function registerAdoExperiment({ task, model, config }) {
  jsPsychADO.registerTask(task.id, task);
  jsPsychADO.registerModelPackage(model, {
    stan: config.stan,
    n_trials: config.n_trials,
    testlet_size: config.testlet_size,
    stopping: config.stopping,
  });
}

function makeTimelineConfig(task, config) {
  return {
    n_trials: config.n_trials,
    testlet_size: config.testlet_size,
    stopping: config.stopping,
    response_labels: task.response_labels,
    presentation: task.presentation,
    choices: task.choices,
    responseToOutcome: task.responseToOutcome,
    task: task.id,
    // Injected jsPsych plugin classes for bundler consumers (#57); undefined on
    // static-served pages, where ado_timeline falls back to the UMD globals.
    plugins: config.plugins,
  };
}

/**
 * Build the demo timeline for the resolved run mode: a mock-controller timeline when
 * controller=mock, otherwise the real Stan timeline via jsPsychADO.createTimeline. This is
 * the demo's wrapper around the public API (which is all your own experiment needs).
 *
 * @param {Object} jsPsych
 * @param {Object} opts - { task, model, config, run_context, session_id, design_seed? }.
 * @returns {Array} jsPsych timeline fragment.
 */
function createExperimentAdoTimeline(
  jsPsych,
  { task, model, config, run_context, session_id, design_seed = null },
) {
  const timeline_config = makeTimelineConfig(task, config);

  if (run_context.controller_mode === "mock") {
    const mock_controller = createMockAdoController({
      grid_design: task.design_grid,
      params: model.params,
      n_trials: config.n_trials,
      testlet_size: config.testlet_size,
      stopping: config.stopping,
    });
    return createAdoTimeline(jsPsych, mock_controller, timeline_config, run_context);
  }

  return jsPsychADO.createTimeline(
    jsPsych,
    {
      model: model.id,
      task: task.id,
      session_id,
      n_trials: config.n_trials,
      design_strategy: run_context.design_strategy,
      design_seed,
      testlet_size: config.testlet_size,
      stopping: config.stopping,
      plugins: config.plugins,
    },
    run_context,
  );
}

export {
  addAdoDataProperties,
  createExperimentAdoTimeline,
  DEFAULT_VISUAL_SIMULATION_RT,
  getExperimentRunSettings,
  getSimulationModeDefaults,
  getRunSelection,
  makeAdoRunContext,
  makeEndSimulationData,
  makeInstructionSimulationData,
  registerAdoExperiment,
  resolveSimulationConfig,
};
