import { test } from "node:test";
import assert from "node:assert/strict";

import { createAdoTimeline } from "../../jspsych-ado/ado/ado_timeline.js";
import { jsPsychADO, parseStanPriors, validateModel } from "../../jspsych-ado/index.js";

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

const STAN_CODE = `
data {
  int<lower=0> N;
}
parameters {
  real<lower=0> k;
  real tau;
}
model {
  k ~ lognormal(-4, 2);
  tau ~ normal(1, 3);
}
`;

const DESIGN_GRID = {
  t_ss: [0],
  t_ll: [1],
  r_ss: [100],
  r_ll: [200],
};

const TESTLET_DESIGN_GRID = {
  t_ss: [0],
  t_ll: [1, 2, 3],
  r_ss: [100],
  r_ll: [200],
};

const DESIGN_KEYS = ["t_ss", "t_ll", "r_ss", "r_ll"];
const RESPONSE_SPACE = { type: "binary" };

function responseProb(design, theta) {
  const gap = design.r_ll - design.r_ss - theta.k * design.t_ll;
  return 1 / (1 + Math.exp(-theta.tau * gap));
}

function makeModel(overrides = {}) {
  return {
    id: "test-model",
    params: ["k", "tau"],
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    prior: {
      k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
      tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
    },
    moduleUrl: "/compiled/main.js",
    wasmUrl: "/compiled/main.wasm",
    buildData: (trials) => ({
      N: trials.length,
      t_ss: trials.map((trial) => trial.t_ss),
      t_ll: trials.map((trial) => trial.t_ll),
      r_ss: trials.map((trial) => trial.r_ss),
      r_ll: trials.map((trial) => trial.r_ll),
      y: trials.map((trial) => trial.choice),
    }),
    responseProb,
    ...overrides,
  };
}

function installFakeSamplingWorker(draws = { k: [0.01], tau: [1] }) {
  const originalWorker = globalThis.Worker;
  const sample_releases = [];
  const messages = [];
  globalThis.Worker = class FakeSamplingWorker {
    postMessage(message) {
      messages.push(message);
      if (message.type === "sample") {
        sample_releases.push(() => {
          queueMicrotask(() => {
            this.onmessage({ data: { type: "ok", draws } });
          });
        });
        return;
      }
      queueMicrotask(() => {
        this.onmessage({ data: { type: "ok" } });
      });
    }
    terminate() {}
  };
  return {
    releaseSample() {
      const release = sample_releases.shift();
      if (release) {
        release();
      }
    },
    get messages() {
      return messages.slice();
    },
    get pendingSamples() {
      return sample_releases.length;
    },
    restore() {
      globalThis.Worker = originalWorker;
    },
  };
}

async function waitForSampleRequest(fake) {
  for (let i = 0; i < 10; i++) {
    if (fake.pendingSamples > 0) {
      return;
    }
    await Promise.resolve();
  }
}

test("parseStanPriors emits the prior schema sampled by mi_engine", () => {
  assert.deepEqual(parseStanPriors(STAN_CODE, ["k", "tau"]), {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "normal", mean: 1, sd: 3 },
  });
});

test("parseStanPriors rejects malformed supported priors instead of yielding NaN draws", () => {
  assert.throws(() => parseStanPriors("tau ~ normal(1);", ["tau"]), /expects 2 numeric arguments/);
  assert.throws(() => parseStanPriors("k ~ lognormal(-4);", ["k"]), /expects 2 numeric arguments/);
});

test("validateModel keeps the model package statistical", () => {
  assert.equal(validateModel(makeModel()).valid, true);

  const stale = validateModel(makeModel({ responseToOutcome: () => 1, task: "demo" }));
  assert.equal(stale.valid, false);
  assert.ok(stale.problems.some((p) => /responseToOutcome/.test(p.message)));
  assert.ok(stale.problems.some((p) => /task/.test(p.message)));
});

test("createController builds user-authored trials and awaits model updates in on_finish", async () => {
  const fake = installFakeSamplingWorker();
  try {
    const ado = jsPsychADO.createController({}, {
      model: makeModel(),
      design_grid: DESIGN_GRID,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1 },
    });

    const trial = {
      type: "html-button-response",
      stimulus: () =>
        `${ado.evaluateDesignVariable("r_ss")} now or ${ado.evaluateDesignVariable("r_ll")} later?`,
      choices: ["Sooner", "Later"],
      on_finish: (data) => ado.recordResponse(data.response),
    };

    const timeline = ado.createTimeline(trial, { n_trials: 1 });
    const choice = flattenTimeline(timeline)[0];

    choice.on_start({});
    assert.equal(choice.stimulus(), "100 now or 200 later?");

    const row = { response: 1 };
    let finished = false;
    const finish = choice.on_finish(row).then(() => { finished = true; });
    await waitForSampleRequest(fake);

    assert.equal(finished, false, "on_finish should wait for the async model sample");
    assert.equal(fake.pendingSamples, 1);
    fake.releaseSample();
    await finish;

    assert.equal(finished, true);
    assert.equal(row.choice, 1);
    assert.deepEqual(row.ado_design, { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 });
    assert.equal(row.ado_event, "update");
    assert.equal(row.ado_trial_index, 1);
    assert.equal(row.choice_label, "Later");
    assert.equal(row.model_id, "test-model");
    assert.equal(row.task, undefined);
  } finally {
    fake.restore();
  }
});

test("createController supports a user-authored adaptive trial array", async () => {
  const fake = installFakeSamplingWorker();
  try {
    const ado = jsPsychADO.createController({}, {
      model: makeModel(),
      design_grid: DESIGN_GRID,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1 },
    });

    const prelude = {
      type: "html-keyboard-response",
      stimulus: () => `Offer starts at ${ado.evaluateDesignVariable("r_ss")}`,
      choices: "NO_KEYS",
    };
    const response = {
      type: "html-button-response",
      stimulus: () => `${ado.getDesign().r_ss} now or ${ado.getDesign().r_ll} later?`,
      choices: ["Sooner", "Later"],
      on_finish: (data) => ado.recordResponse(data.response),
    };

    const timeline = ado.createTimeline([prelude, response], { n_trials: 1 });
    const [prelude_trial, response_trial] = flattenTimeline(timeline);

    prelude_trial.on_start({});
    assert.equal(prelude_trial.stimulus(), "Offer starts at 100");
    assert.equal(response_trial.stimulus(), "100 now or 200 later?");

    const row = { response: 1 };
    const finish = response_trial.on_finish(row);
    await waitForSampleRequest(fake);
    fake.releaseSample();
    await finish;

    assert.equal(row.task, undefined);
    assert.equal(row.choice, 1);
    assert.equal(row.choice_label, "Later");
    assert.deepEqual(row.ado_design, { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 });
  } finally {
    fake.restore();
  }
});

test("createController can run the same user-authored trial with the mock controller", async () => {
  const ado = jsPsychADO.createController({}, {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
    n_trials: 1,
  });

  const trial = {
    type: "html-button-response",
    stimulus: () =>
      `${ado.evaluateDesignVariable("r_ss")} now or ${ado.evaluateDesignVariable("r_ll")} later?`,
    choices: ["Sooner", "Later"],
    on_finish: (data) => ado.recordResponse(data.response),
  };

  const timeline = ado.createTimeline(trial);
  const choice = flattenTimeline(timeline)[0];

  choice.on_start({});
  assert.equal(choice.stimulus(), "100 now or 200 later?");

  const row = { response: 0 };
  await choice.on_finish(row);

  assert.equal(row.task, undefined);
  assert.equal(row.choice, 0);
  assert.equal(row.choice_label, "Sooner");
  assert.equal(row.controller_mode, "mock");
  assert.equal(row.design_strategy, null);
  assert.equal(typeof row.post_mean_k, "number");
  assert.deepEqual(row.ado_design, { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 });
});

test("createController lets the ADO timeline own debug finalization without leaking run_context", async () => {
  const ado = jsPsychADO.createController({}, {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
    n_trials: 1,
  });

  const trial = {
    type: "html-button-response",
    stimulus: () => "choose",
    choices: ["Sooner", "Later"],
    on_finish: (data) => ado.recordResponse(data.response),
  };

  const timeline = ado.createTimeline(trial, { debug: true });
  const choice = flattenTimeline(timeline)[0];
  assert.equal(typeof timeline[0].on_timeline_finish, "function");

  choice.on_start({});
  const row = { response: 1 };
  await choice.on_finish(row);

  assert.equal(row.run_context, undefined);
  assert.equal(row.ado_event, "update");
  assert.doesNotThrow(() => timeline[0].on_timeline_finish());
});

test("createController leaves response mapping in user on_finish before recordResponse", async () => {
  const build_data_calls = [];
  const model = makeModel({
    buildData: (trials) => {
      build_data_calls.push(trials.map((trial) => trial.choice));
      return {
        N: trials.length,
        t_ss: trials.map((trial) => trial.t_ss),
        t_ll: trials.map((trial) => trial.t_ll),
        r_ss: trials.map((trial) => trial.r_ss),
        r_ll: trials.map((trial) => trial.r_ll),
        y: trials.map((trial) => trial.choice),
      };
    },
  });
  const fake = installFakeSamplingWorker();
  try {
    const ado = jsPsychADO.createController({}, {
      model,
      design_grid: DESIGN_GRID,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1 },
    });

    const trial = {
      type: "html-button-response",
      stimulus: () => "Which color had more dots?",
      choices: ["Blue", "Yellow"],
      on_finish: (data) => {
        const chose_blue = data.response === 0;
        const blue_is_correct = true;
        ado.recordResponse(chose_blue === blue_is_correct ? 1 : 0);
      },
    };

    const timeline = ado.createTimeline(trial, {
      n_trials: 1,
      response_labels: { 0: "incorrect", 1: "correct" },
    });
    const choice = flattenTimeline(timeline)[0];
    choice.on_start({});

    const row = { response: 1 };
    const finish = choice.on_finish(row);
    await waitForSampleRequest(fake);
    fake.releaseSample();
    await finish;

    assert.equal(row.response, 1, "raw jsPsych response remains available");
    assert.equal(row.choice, 0, "model-ready mapped response is saved as choice");
    assert.equal(row.choice_label, "incorrect");
    assert.deepEqual(build_data_calls.at(-1), [0], "Stan data receives the mapped model response");
  } finally {
    fake.restore();
  }
});

test("createController requires the response trial to call ado.recordResponse", async () => {
  const fake = installFakeSamplingWorker();
  try {
    const ado = jsPsychADO.createController({}, {
      model: makeModel(),
      design_grid: DESIGN_GRID,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1 },
    });
    const timeline = ado.createTimeline({
      type: "html-button-response",
      stimulus: () => "choose",
      choices: ["Sooner", "Later"],
      on_finish: () => {},
    }, { n_trials: 1 });
    const choice = flattenTimeline(timeline)[0];
    choice.on_start({});

    await assert.rejects(() => choice.on_finish({ response: 1 }), /without calling ado\.recordResponse/);
  } finally {
    fake.restore();
  }
});

test("createController validates design_grid against model design keys", () => {
  assert.throws(
    () => jsPsychADO.createController({}, {
      model: makeModel({ id: "missing-key-model", designKeys: ["missing"] }),
      design_grid: DESIGN_GRID,
    }),
    /missing model design key "missing"/
  );
});

test("response_labels are inferred from static choices and can be validated explicitly", () => {
  const fake = installFakeSamplingWorker();
  try {
    const ado = jsPsychADO.createController({}, {
      model: makeModel(),
      design_grid: DESIGN_GRID,
    });

    assert.throws(
      () => ado.createTimeline({
        type: "html-button-response",
        stimulus: () => "choose",
        choices: ["Only one"],
        on_finish: (data) => ado.recordResponse(data.response),
      }),
      /response_labels has 1 entries; expected 2/
    );

    assert.throws(
      () => ado.createTimeline({
        type: "html-button-response",
        stimulus: () => "choose",
        choices: ["A", "B"],
        on_finish: (data) => ado.recordResponse(data.response),
      }, { response_labels: ["A", "B", "C"] }),
      /response_labels has 3 entries; expected 2/
    );
  } finally {
    fake.restore();
  }
});

test("createAdoTimeline batches testlets and refills designs at boundaries", async () => {
  const seen_batches = [];
  const controller = {
    start: () => ({
      session_id: "testlet-session",
      trial_index: 0,
      next_design: { d: 1 },
      next_designs: [{ d: 1 }, { d: 2 }],
      next_design_metrics: [{ mutual_info: 0.10 }, { mutual_info: 0.20 }],
      post_mean: null,
      post_sd: null,
      should_stop: false,
      stop_reason: null,
    }),
    update: async (payload) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      seen_batches.push(rows.map((row) => ({ design: row.ado_design, choice: row.choice })));
      return {
        session_id: "testlet-session",
        trial_index: rows.length,
        next_design: null,
        next_designs: [],
        next_design_metrics: [],
        post_mean: { k: 0.1 },
        post_sd: { k: 0.01 },
        api_latency_ms: 5,
        should_stop: false,
        stop_reason: null,
      };
    },
  };

  const timeline = flattenTimeline(createAdoTimeline({}, controller, {
    n_trials: 2,
    testlet_size: 2,
    response_labels: { 0: "SS", 1: "LL" },
    choices: ["SS", "LL"],
    getChoiceTrials: () => [{
      type: "html-button-response",
      on_finish: (data) => { data.__ado_response = data.response; },
      __ado_is_response: true,
    }],
  }));

  const first = timeline[0];
  const second = timeline[1];

  first.on_start({});
  await first.on_finish({ response: 1 });
  assert.deepEqual(seen_batches, [], "first response in a testlet should not update yet");

  second.on_start({});
  const second_row = { response: 0 };
  await second.on_finish(second_row);

  assert.deepEqual(seen_batches, [[
    { design: { d: 1 }, choice: 1 },
    { design: { d: 2 }, choice: 0 },
  ]]);
  assert.equal(second_row.ado_testlet_size, 2);
  assert.equal(second_row.post_mean_k, 0.1);
});
