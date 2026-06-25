import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VISUAL_SIMULATION_RT,
  getSimulationModeDefaults,
  makeEndSimulationData,
  makeInstructionSimulationData,
  resolveSimulationConfig,
} from "../../demos/_shared/experiment_shell.js";

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
