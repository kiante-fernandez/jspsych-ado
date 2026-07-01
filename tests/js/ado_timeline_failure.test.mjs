// Error-path tests for the generic ADO timeline. failExperiment is the single
// user-visible failure surface: when the controller's update() rejects (e.g. the
// Stan worker failed to load or sampling errored), the composed on_finish must
// stamp an error row AND abort the experiment with a visible message, so a failure
// never silently continues against a stale design. start() is synchronous by
// contract — returning a promise is a programming error caught at build time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdoTimeline } from "../../src/ado/ado_timeline.js";

const TIMELINE_CONFIG = {
  n_trials: 2,
  testlet_size: 1,
  response_labels: { 0: "SS", 1: "LL" },
  getChoiceTrials: () => [
    {
      type: "x",
      stimulus: "s",
      __ado_is_response: true,
      on_finish: (data) => {
        data.__ado_response = 1;
      },
    },
  ],
};

const START_RESULT = {
  session_id: "s",
  trial_index: 0,
  next_design: { t_ll: 1 },
  next_designs: [{ t_ll: 1 }],
  should_stop: false,
  post_mean: null,
  post_sd: null,
};

function quietConsoleError(run) {
  const original = console.error;
  console.error = () => {};
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console.error = original;
    });
}

test("an async controller.start() is rejected synchronously (sync-start contract)", () => {
  const controller = {
    start: async () => START_RESULT,
    update: async () => START_RESULT,
  };
  assert.throws(
    () => createAdoTimeline({}, controller, TIMELINE_CONFIG, { debug: false }),
    /must return the initial design state synchronously/,
  );
});

test("a rejecting controller.update() aborts the experiment with an error row, not a hang", async () => {
  await quietConsoleError(async () => {
    let aborted = null;
    const jsPsych = {
      abortExperiment: (html, data) => {
        aborted = { html, data };
      },
    };
    const controller = {
      start: () => START_RESULT,
      update: async () => {
        throw new Error("sampling exploded");
      },
    };
    const fragment = createAdoTimeline(jsPsych, controller, TIMELINE_CONFIG, { debug: false });
    const trial = fragment[0].timeline[0].timeline[0];
    if (trial.on_start) trial.on_start(trial);

    const data = {};
    await assert.rejects(() => trial.on_finish(data), /sampling exploded/);
    assert.equal(data.ado_event, "error");
    assert.match(data.ado_error, /sampling exploded/);
    assert.ok(aborted, "abortExperiment was called");
    assert.match(aborted.html, /cannot continue/);
    assert.match(aborted.data.ado_error, /sampling exploded/);
  });
});

test("falls back to endExperiment when abortExperiment is unavailable", async () => {
  await quietConsoleError(async () => {
    let ended = null;
    const jsPsych = {
      endExperiment: (html, data) => {
        ended = { html, data };
      },
    };
    const controller = {
      start: () => START_RESULT,
      update: async () => {
        throw new Error("boom");
      },
    };
    const fragment = createAdoTimeline(jsPsych, controller, TIMELINE_CONFIG, { debug: false });
    const trial = fragment[0].timeline[0].timeline[0];
    await assert.rejects(() => trial.on_finish({}), /boom/);
    assert.ok(ended, "endExperiment was called as the fallback");
  });
});

test("a design-queue underflow at trial start aborts instead of rendering a null design", async () => {
  await quietConsoleError(async () => {
    let aborted = null;
    const jsPsych = {
      abortExperiment: (html, data) => {
        aborted = { html, data };
      },
    };
    // update() returns NO next designs while more trials remain.
    const controller = {
      start: () => START_RESULT,
      update: async () => ({ ...START_RESULT, next_design: null, next_designs: [] }),
    };
    const fragment = createAdoTimeline(jsPsych, controller, TIMELINE_CONFIG, { debug: false });
    const first = fragment[0].timeline[0].timeline[0];
    await first.on_finish({});

    const second = fragment[0].timeline[1].timeline[0];
    if (second.on_start) second.on_start(second);
    assert.ok(aborted, "underflow aborts the run");
    assert.match(aborted.data.ado_error, /underflow/);
  });
});
