import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createExperimentAdoTimeline,
  DEFAULT_VISUAL_SIMULATION_RT,
  getRunSelection,
  getSimulationModeDefaults,
  makeEndSimulationData,
  makeInstructionSimulationData,
  resolveSimulationConfig,
} from "../../jspsych-ado/ado/experiment_shell.js";

const DEFAULT_SIMULATION_CONFIG = {
  seed: 123,
  params: {
    theta: 1,
  },
  rt: {
    instructions: 300,
    choice: 500,
    end: 300,
  },
};

function selection(query, opts = {}) {
  return getRunSelection(new URLSearchParams(query), opts);
}

function selectionWithWarnings(query, opts = {}) {
  const original_warn = console.warn;
  const warnings = [];
  console.warn = function(message) {
    warnings.push(message);
  };

  try {
    return {
      result: selection(query, opts),
      warnings,
    };
  } finally {
    console.warn = original_warn;
  }
}

test("resolveSimulationConfig keeps data-only simulation fast", () => {
  const config = resolveSimulationConfig(DEFAULT_SIMULATION_CONFIG, {}, "data-only");
  assert.deepEqual(config.rt, DEFAULT_SIMULATION_CONFIG.rt);
});

test("resolveSimulationConfig applies slower reusable visual simulation pacing", () => {
  const config = resolveSimulationConfig(DEFAULT_SIMULATION_CONFIG, {}, "visual");
  assert.deepEqual(config.rt, DEFAULT_VISUAL_SIMULATION_RT);

  const instructions = makeInstructionSimulationData(3, config);
  assert.equal(instructions.rt, 2100);
  assert.deepEqual(instructions.view_history.map(row => row.viewing_time), [700, 700, 700]);

  const end = makeEndSimulationData(config);
  assert.equal(end.rt, 600);
});

test("resolveSimulationConfig lets injected run config override visual pacing", () => {
  const config = resolveSimulationConfig(DEFAULT_SIMULATION_CONFIG, {
    simulation: {
      params: {
        theta: 2,
      },
      rt: {
        choice: 1200,
      },
    },
  }, "visual");

  assert.equal(config.params.theta, 2);
  assert.equal(config.rt.instructions, 700);
  assert.equal(config.rt.choice, 1200);
  assert.equal(config.rt.end, 600);
});

test("getSimulationModeDefaults only changes visual mode", () => {
  assert.deepEqual(getSimulationModeDefaults(null), {});
  assert.deepEqual(getSimulationModeDefaults("data-only"), {});
  assert.deepEqual(getSimulationModeDefaults("visual"), {
    rt: DEFAULT_VISUAL_SIMULATION_RT,
  });
});

test("getRunSelection only enables optional controllers when experiments opt in", () => {
  const default_run = selectionWithWarnings("controller=quest_plus");
  assert.deepEqual(default_run.result, {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });
  assert.equal(default_run.warnings.length, 1);
  assert.match(default_run.warnings[0], /Unknown controller/);

  assert.deepEqual(selection("controller=quest_plus", { controllers: ["mock", "stan", "quest_plus"] }), {
    controller_mode: "quest_plus",
    design_strategy: null,
    ado_mode: "quest_plus",
  });
});

test("optional controller factories declare supported testlet size", () => {
  const task = {
    id: "demo-task",
    response_labels: { 0: "A", 1: "B" },
    presentation: { makeStimulus: () => "" },
    choices: ["A", "B"],
  };
  const model = {
    id: "demo-model",
    params: ["theta"],
    posterior_display: {},
  };
  const run_context = {
    controller_mode: "quest_plus",
    ado_mode: "quest_plus",
    design_strategy: null,
  };

  assert.throws(
    () => createExperimentAdoTimeline({}, {
      task,
      model,
      config: { n_trials: 4, testlet_size: 2 },
      run_context,
      session_id: "demo",
      controller_factories: {
        quest_plus: {
          max_testlet_size: 1,
          create: () => {
            throw new Error("factory should not be called");
          },
        },
      },
    }),
    /controller "quest_plus" supports testlet_size up to 1; got 2/
  );
});

test("optional controller modes require an experiment-supplied factory", () => {
  assert.throws(
    () => createExperimentAdoTimeline({}, {
      task: { id: "demo-task", response_labels: {}, presentation: { makeStimulus: () => "" } },
      model: { id: "demo-model", params: [], posterior_display: {} },
      config: { n_trials: 1, testlet_size: 1 },
      run_context: { controller_mode: "quest_plus", ado_mode: "quest_plus", design_strategy: null },
      session_id: "demo",
    }),
    /controller "quest_plus" is not available/
  );
});
