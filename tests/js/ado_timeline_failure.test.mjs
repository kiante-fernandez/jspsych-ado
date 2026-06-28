import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdoTimeline } from "../../jspsych-ado/ado/ado_timeline.js";

const DESIGN = { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 };

const TIMELINE_CONFIG = {
  n_trials: 1,
  testlet_size: 1,
  response_labels: { 0: "SS", 1: "LL" },
  choices: ["SS", "LL"],
  getChoiceTrials(ctx) {
    return [{
      type: "fake-response",
      data: () => ({ trial_number: ctx.trial_number }),
      on_finish: (data) => { data.__ado_response = data.response; },
      __ado_is_response: true,
    }];
  },
};

function flattenTimeline(timeline) {
  const out = [];
  for (const node of timeline) {
    if (node && Array.isArray(node.timeline)) {
      out.push(...flattenTimeline(node.timeline));
    } else {
      out.push(node);
    }
  }
  return out;
}

test("createAdoTimeline rejects async start contracts", () => {
  const controller = {
    start: async () => ({
      session_id: "s",
      trial_index: 0,
      next_design: DESIGN,
      next_designs: [DESIGN],
      next_design_metrics: [{ mutual_info: 0.5 }],
    }),
    update: async () => ({}),
  };

  assert.throws(
    () => createAdoTimeline({}, controller, TIMELINE_CONFIG, {}),
    /start\(\) must return the initial design state synchronously/
  );
});

test("a rejecting controller.update() aborts the experiment and rejects on_finish", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    let aborted = null;
    const jsPsych = {
      abortExperiment: (message, data) => { aborted = { message, data }; },
    };
    const controller = {
      start: () => ({
        session_id: "s",
        trial_index: 0,
        next_design: DESIGN,
        next_designs: [DESIGN],
        next_design_metrics: [{ mutual_info: 0.5 }],
        max_mutual_info: 0.5,
        post_mean: null,
        post_sd: null,
        should_stop: false,
        stop_reason: null,
      }),
      update: async () => { throw new Error("sampling boom"); },
    };

    const tl = createAdoTimeline(jsPsych, controller, TIMELINE_CONFIG, {});
    const choice_trial = flattenTimeline(tl)[0];
    choice_trial.on_start({});
    const row = { ...choice_trial.data(), response: 1 };

    await assert.rejects(() => choice_trial.on_finish(row), /sampling boom/);
    assert.equal(row.ado_event, "error");
    assert.match(row.ado_error, /sampling boom/);
    assert.ok(aborted, "abortExperiment must be called so the run does not silently continue");
    assert.match(aborted.message, /sampling boom/);
    assert.match(aborted.data.ado_error, /sampling boom/);
  } finally {
    console.error = originalError;
  }
});
