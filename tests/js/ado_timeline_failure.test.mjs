// Error-path tests for the generic ADO timeline. failExperiment is the single
// user-visible failure surface: when the controller's start()/update() rejects
// (e.g. the Stan worker failed to load or sampling errored), the timeline must
// complete the in-flight call-function trial with an error row AND end the
// experiment with a visible message, so a failure never silently hangs the run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdoTimeline } from "../../src/ado/ado_timeline.js";

const TEST_PRESENTATION = { makeStimulus: () => "<p>choose</p>" };
const DESIGN = { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 };

const TIMELINE_CONFIG = {
  n_trials: 2,
  testlet_size: 1,
  response_labels: { 0: "SS", 1: "LL" },
  presentation: TEST_PRESENTATION,
  choices: ["SS", "LL"],
  task: "fail-demo",
};

// Drive an async call-function node: its func receives `done`; resolve when done
// is called, reject on timeout so a never-finishing node fails the test loudly.
function runNode(node) {
  return new Promise((resolve, reject) => {
    node.func(resolve);
    setTimeout(() => reject(new Error("node never called done")), 500);
  });
}

function withTimelinePlugins(run) {
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";
  const originalError = console.error;
  console.error = () => {}; // failExperiment logs the error; keep test output clean
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console.error = originalError;
      delete globalThis.jsPsychCallFunction;
      delete globalThis.jsPsychHtmlButtonResponse;
    });
}

test("a rejecting controller.start() ends the experiment with an error row, not a hang", async () => {
  await withTimelinePlugins(async () => {
    let ended = null;
    const jsPsych = {
      endExperiment: (message) => {
        ended = message;
      },
    };
    const controller = {
      start: async () => {
        throw new Error("worker boom");
      },
      update: async () => ({}),
    };

    const tl = createAdoTimeline(jsPsych, controller, TIMELINE_CONFIG, {});
    const result = await runNode(tl[0]); // the initialize_ado node

    assert.equal(result.ado_event, "error", "the start node should emit an error event");
    assert.match(
      result.ado_error,
      /worker boom/,
      "the rejection message should be recorded in the data",
    );
    assert.ok(ended != null, "endExperiment must be called so the run does not hang");
    assert.match(ended, /worker boom/, "the visible end message should include the failure reason");
  });
});

test("a rejecting controller.update() ends the experiment with an error row, not a hang", async () => {
  await withTimelinePlugins(async () => {
    let ended = null;
    const jsPsych = {
      endExperiment: (message) => {
        ended = message;
      },
    };
    const controller = {
      start: async () => ({
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
      update: async () => {
        throw new Error("sampling boom");
      },
    };

    const tl = createAdoTimeline(jsPsych, controller, TIMELINE_CONFIG, {});
    await runNode(tl[0]); // start succeeds

    // Run the first testlet's choice trial so the update has a recorded response.
    const testlet = tl[1];
    const choice_trial = testlet.timeline[0];
    const update_trial = testlet.timeline[1];
    choice_trial.on_start({});
    choice_trial.on_finish({ ...choice_trial.data(), response: 1 });

    const result = await runNode(update_trial);

    assert.equal(result.ado_event, "error", "the update node should emit an error event");
    assert.match(
      result.ado_error,
      /sampling boom/,
      "the rejection message should be recorded in the data",
    );
    assert.ok(ended != null, "endExperiment must be called so the run does not hang");
    assert.match(
      ended,
      /sampling boom/,
      "the visible end message should include the failure reason",
    );
  });
});
