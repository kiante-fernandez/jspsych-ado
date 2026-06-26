import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateCategoricalChoice } from "../../src/ado/ado_simulation.js";

const DESIGN = {
  r_ss: 100,
  t_ss: 0,
  r_ll: 200,
  t_ll: 52,
};

const SIM_CONFIG = {
  params: {
    k: 0.001,
    tau: 2.5,
  },
  rt: {
    choice: 500,
  },
};

const TEST_MODEL = {
  responseProbs: () => [0.8, 0.2],
  subjectiveValues: () => ({
    v_ss: 100,
    v_ll: 80,
  }),
};

function fixedRng(value) {
  return () => value;
}

test("simulateCategoricalChoice (binary): cumulative sampling + both sim_* model hooks", () => {
  // response_labels name the sim_p_<label> fields; the model's subjectiveValues hook
  // (design-level) contributes sim_v_*. Both hooks now run inside simulateCategoricalChoice.
  const ss_choice = simulateCategoricalChoice(DESIGN, SIM_CONFIG, fixedRng(0.1), TEST_MODEL, {
    response_labels: { 0: "SS", 1: "LL" },
  });
  assert.equal(ss_choice.response, 0);
  assert.equal(ss_choice.sim_p_ss, 0.8);
  assert.equal(ss_choice.sim_p_ll, 0.2);
  assert.equal(ss_choice.sim_draw, 0.1);
  assert.equal(ss_choice.sim_v_ss, 100);
  assert.equal(ss_choice.sim_v_ll, 80);

  const ll_choice = simulateCategoricalChoice(DESIGN, SIM_CONFIG, fixedRng(0.9), TEST_MODEL);
  assert.equal(ll_choice.response, 1);
  assert.equal(ll_choice.sim_draw, 0.9);
});
