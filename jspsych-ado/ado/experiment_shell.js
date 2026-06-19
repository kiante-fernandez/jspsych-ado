import { jsPsychADO } from "../index.js";
import { createAdoTimeline } from "./ado_timeline.js";
import { createMockAdoController } from "../controllers/mock_ado_controller.js";
import { createQuestPlusController } from "../controllers/quest_plus_controller.js";

const VALID_CONTROLLERS = ["mock", "stan", "quest_plus"];
const VALID_STRATEGIES = ["ado", "random"];
const VALID_SIMULATION_MODES = ["data-only", "visual"];
const DEFAULT_VISUAL_SIMULATION_RT = {
  instructions: 700,
  choice: 1000,
  end: 600,
};

function getRunSelection(params, opts = {}) {
  const requested_ado_mode = params.get("ado");
  const requested_controller = params.get("controller");
  const requested_strategy = params.get("strategy");
  const allow_legacy_ado = opts.allow_legacy_ado === true;

  let controller_mode = "stan";
  let design_strategy = "ado";

  if (requested_ado_mode && allow_legacy_ado) {
    if (requested_ado_mode === "mock") {
      controller_mode = "mock";
      design_strategy = null;
    } else if (requested_ado_mode === "stan" || requested_ado_mode === "ado") {
      controller_mode = "stan";
      design_strategy = "ado";
    } else if (requested_ado_mode === "random") {
      controller_mode = "stan";
      design_strategy = "random";
    } else if (requested_ado_mode === "quest_plus") {
      controller_mode = "quest_plus";
      design_strategy = null;
    } else {
      console.warn(`Unknown legacy ado mode "${requested_ado_mode}"; running controller=stan&strategy=ado.`);
    }
  } else if (requested_ado_mode && !allow_legacy_ado) {
    console.warn("ado= is not used by this experiment; use controller= and strategy=.");
  }

  if (requested_ado_mode && allow_legacy_ado && (requested_controller || requested_strategy)) {
    console.warn("Both legacy ado= and controller=/strategy= URL parameters were provided; using controller=/strategy=.");
  }

  if (requested_controller) {
    if (VALID_CONTROLLERS.includes(requested_controller)) {
      controller_mode = requested_controller;
    } else {
      console.warn(`Unknown controller "${requested_controller}"; using controller=${controller_mode}.`);
    }
  }

  if (requested_strategy) {
    if (VALID_STRATEGIES.includes(requested_strategy)) {
      design_strategy = requested_strategy;
    } else {
      console.warn(`Unknown strategy "${requested_strategy}"; using strategy=${design_strategy || "none"}.`);
    }
  }

  if (controller_mode === "mock") {
    if (requested_strategy) {
      console.warn("strategy= is ignored when controller=mock.");
    }
    design_strategy = null;
  }
  if (controller_mode === "quest_plus") {
    if (requested_strategy) {
      console.warn("strategy= is ignored when controller=quest_plus.");
    }
    design_strategy = null;
  }

  return {
    controller_mode,
    design_strategy,
    ado_mode: controller_mode === "mock" || controller_mode === "quest_plus"
      ? controller_mode
      : (design_strategy === "random" ? "random" : "stan"),
  };
}

function getExperimentRunSettings(params, opts = {}) {
  const requested_simulation_mode = params.get("simulate");
  return {
    ...getRunSelection(params, opts),
    debug: params.get("debug") === "1",
    simulation_mode: VALID_SIMULATION_MODES.includes(requested_simulation_mode)
      ? requested_simulation_mode
      : null,
  };
}

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

function resolveSimulationConfig(default_config, run_config, simulation_mode = null) {
  const mode_config = getSimulationModeDefaults(simulation_mode);
  const base_config = mergeSimulationConfig(default_config, mode_config);
  return mergeSimulationConfig(base_config, getSimulationOverride(run_config || {}));
}

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
      Object.entries(simulation_config.params).map(([name, value]) => ["sim_" + name, value])
    ),
  });
}

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

function createExperimentAdoTimeline(jsPsych, {
  QuestPlus,
  task,
  model,
  config,
  run_context,
  session_id,
  design_seed = null,
}) {
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

  if (run_context.controller_mode === "quest_plus") {
    const quest_plus_controller = createQuestPlusController({
      QuestPlus,
      model,
      grid_design: task.design_grid,
      quest_plus: config.quest_plus,
      session_id,
      n_trials: config.n_trials,
    });
    return createAdoTimeline(jsPsych, quest_plus_controller, timeline_config, run_context);
  }

  return jsPsychADO.createTimeline(jsPsych, {
    model: model.id,
    task: task.id,
    session_id,
    n_trials: config.n_trials,
    design_strategy: run_context.design_strategy,
    design_seed,
    testlet_size: config.testlet_size,
    stopping: config.stopping,
    plugins: config.plugins,
  }, run_context);
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
  mergeSimulationConfig,
  registerAdoExperiment,
  resolveSimulationConfig,
};
