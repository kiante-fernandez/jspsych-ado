import { test } from "node:test";
import assert from "node:assert/strict";

import { samplePriorDraws } from "../../jspsych-ado/ado/mi_engine.js";
import { createAdoTimeline } from "../../jspsych-ado/ado/ado_timeline.js";
import { createSeededRng } from "../../jspsych-ado/ado/ado_simulation.js";
import { createStanAdoController } from "../../jspsych-ado/controllers/stan_ado_controller.js";
import { compileStanModel } from "../../jspsych-ado/models/compile_stan_model.js";
import {
  buildAdapter,
  createTimeline,
  labelsToConfig,
  parseStanPriors,
  prepareModels,
  registerModel,
  registerModelPackage,
  registerTask,
  validateModel,
  validateTask,
} from "../../jspsych-ado/index.js";

const STAN_CODE = `
data {
  int<lower=0> N;
}
parameters {
  real<lower=0> k;
  real tau;
  real<lower=0> beta;
}
model {
  k ~ lognormal(-4, 2);
  tau ~ normal(1, 3);
  beta ~ normal(0, 2);
}
`;

const UNSUPPORTED_STAN_CODE = `
data {
  int<lower=0> N;
}
parameters {
  real<lower=0> k;
}
model {
  k ~ gamma(2, 3);
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

const TO_STAN_DATA = (trials) => ({
  N: trials.length,
  y: trials.map((trial) => trial.response),
});

// A minimal presentation that satisfies the timeline's single-button path.
const TEST_PRESENTATION = { makeStimulus: () => "<p>choose</p>" };

function responseProb(design, theta) {
  const gap = design.r_ll - design.r_ss - theta.k * design.t_ll;
  return 1 / (1 + Math.exp(-theta.tau * gap));
}

function installFakeWorker() {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class FakeWorker {
    postMessage() {
      queueMicrotask(() => {
        this.onmessage({ data: { type: "ok" } });
      });
    }
  };
  return () => {
    globalThis.Worker = originalWorker;
  };
}

function installFakeFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function(url) {
    const text_url = String(url);
    if (text_url.endsWith("/models/test-model.stan")) {
      return {
        ok: true,
        text: async () => STAN_CODE,
      };
    }
    if (text_url === "http://compile.test/compile") {
      return {
        ok: true,
        json: async () => ({ model_id: "fake-model" }),
      };
    }
    return {
      ok: false,
      status: 404,
      text: async () => "not found",
    };
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function registerTestTask(name, overrides = {}) {
  registerTask(name, {
    id: name,
    design_grid: DESIGN_GRID,
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    presentation: TEST_PRESENTATION,
    choices: ["SS", "LL"],
    response_labels: ["SS", "LL"],
    ...overrides,
  });
}

function registerTestModel(name, overrides = {}) {
  registerModel(name, {
    stanCode: STAN_CODE,
    params: ["k", "tau", "beta"],
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    responseProb,
    toStanData: TO_STAN_DATA,
    ...overrides,
  });
}

test("parseStanPriors emits the prior schema sampled by mi_engine", () => {
  const prior = parseStanPriors(STAN_CODE, ["k", "tau", "beta"]);
  assert.deepEqual(prior, {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "normal", mean: 1, sd: 3 },
    beta: { dist: "halfnormal", sd: 2 },
  });

  const draws = samplePriorDraws(prior, 20, createSeededRng(11));
  assert.equal(draws.length, 20);
  for (const draw of draws) {
    assert.ok(Number.isFinite(draw.k));
    assert.ok(Number.isFinite(draw.tau));
    assert.ok(Number.isFinite(draw.beta));
  }
});

test("stanUrl registration derives priors after prepareModels fetches the source", async () => {
  const restoreFetch = installFakeFetch();
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("stan-url-task");
    registerModel("stan-url-model", {
      stanUrl: "/models/test-model.stan",
      params: ["k", "tau", "beta"],
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      responseProb,
      toStanData: TO_STAN_DATA,
    });

    await prepareModels({ compileServer: "http://compile.test" });

    const timeline = createTimeline({}, {
      task: "stan-url-task",
      model: "stan-url-model",
      n_trials: 1,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 17 },
    });

    const start_data = await new Promise((resolve, reject) => {
      timeline[0].func((data) => resolve(data));
      setTimeout(() => reject(new Error("timed out waiting for fake worker")), 100);
    });

    assert.equal(start_data.ado_event, "start");
    assert.equal(start_data.ado_mode, "stan");
    assert.equal(start_data.controller_mode, "stan");
    assert.equal(start_data.design_strategy, "ado");
    const row = timeline[1].data();
    assert.equal(typeof row.t_ss, "number");
    assert.equal(row.r_ll, 200);
    assert.equal(row.trial_number, 1);
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("createTimeline composes on_finish: raw response -> outcome, full design, labels", async () => {
  const restoreFetch = installFakeFetch();
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("data-flow-task", {
      responseToOutcome: (_design, index) => 1 - index,
    });
    registerTestModel("data-flow-model");

    await prepareModels({ compileServer: "http://compile.test" });

    const timeline = createTimeline({}, {
      task: "data-flow-task",
      model: "data-flow-model",
      n_trials: 1,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 5 },
    });

    // Drive start so current_design is the (single) grid design.
    await new Promise((resolve, reject) => {
      timeline[0].func((data) => resolve(data));
      setTimeout(() => reject(new Error("timed out waiting for fake worker")), 100);
    });

    const response_trial = timeline[1];
    assert.equal(response_trial.data().task, "data-flow-task");

    const data = { response: 1 };
    response_trial.on_finish(data);

    assert.equal(data.__ado_response, 1);
    assert.equal(data.choice_raw, 1);
    assert.equal(data.choice, 0, "responseToOutcome should map raw 1 -> outcome 0");
    assert.equal(data.choice_label, "SS", "label should come from the mapped outcome");
    assert.deepEqual(data.ado_design, { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 });
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("createTimeline forwards design strategy into the Stan controller", async () => {
  const restoreFetch = installFakeFetch();
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("strategy-task");
    registerTestModel("strategy-forwarding-model");
    await prepareModels({ compileServer: "http://compile.test" });

    assert.throws(
      () => createTimeline({}, {
        task: "strategy-task",
        model: "strategy-forwarding-model",
        design_strategy: "unsupported",
      }),
      /unknown design_strategy/
    );

    const timeline = createTimeline({}, {
      task: "strategy-task",
      model: "strategy-forwarding-model",
      n_trials: 1,
      design_strategy: "random",
      design_seed: 23,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 7 },
    });

    const start_data = await new Promise((resolve, reject) => {
      timeline[0].func((data) => resolve(data));
      setTimeout(() => reject(new Error("timed out waiting for fake worker")), 100);
    });

    assert.equal(start_data.ado_event, "start");
    assert.equal(start_data.ado_mode, "stan");
    assert.equal(start_data.controller_mode, "stan");
    assert.equal(start_data.design_strategy, "random");
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("createTimeline schedules updates at testlet boundaries", async () => {
  const restoreFetch = installFakeFetch();
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("testlet-structure-task", {
      design_grid: TESTLET_DESIGN_GRID,
    });
    registerTestModel("testlet-structure-model");
    await prepareModels({ compileServer: "http://compile.test" });

    const timeline = createTimeline({}, {
      task: "testlet-structure-task",
      model: "testlet-structure-model",
      n_trials: 5,
      testlet_size: 2,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 5 },
    });

    const choices = timeline.filter((t) => t.type === "html-button-response");
    const calls = timeline.filter((t) => t.type === "call-function");
    assert.equal(choices.length, 5);
    assert.equal(calls.length - 1, 3);
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("createTimeline rejects a non-positive-integer testlet_size", async () => {
  const restoreFetch = installFakeFetch();
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("testlet-validation-task", {
      design_grid: TESTLET_DESIGN_GRID,
    });
    registerTestModel("testlet-validation-model");
    await prepareModels({ compileServer: "http://compile.test" });

    assert.throws(
      () => createTimeline({}, { task: "testlet-validation-task", model: "testlet-validation-model", testlet_size: 0 }),
      /positive integer/
    );
    assert.throws(
      () => createTimeline({}, { task: "testlet-validation-task", model: "testlet-validation-model", testlet_size: 1.5 }),
      /positive integer/
    );
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("createTimeline requires known task and model", () => {
  assert.throws(
    () => createTimeline({}, { task: "missing-task", model: "missing-model" }),
    /unknown task/
  );

  registerTestTask("known-task");
  assert.throws(
    () => createTimeline({}, { task: "known-task", model: "missing-model" }),
    /unknown model/
  );
});

test("createTimeline rejects incompatible task/model design keys and response spaces", () => {
  registerTestTask("compat-task");
  registerModel("missing-key-model", {
    moduleUrl: "/compiled/main.js",
    params: ["k"],
    prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
    designKeys: ["missing_key"],
    responseSpace: RESPONSE_SPACE,
    responseProb: () => 0.5,
    buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
  });

  assert.throws(
    () => createTimeline({}, { task: "compat-task", model: "missing-key-model" }),
    /missing design key "missing_key"/
  );

  registerTestTask("categorical-task", {
    responseSpace: { type: "categorical", n_categories: 3 },
    choices: ["A", "B", "C"],
    response_labels: ["A", "B", "C"],
  });
  registerModel("binary-model-for-mismatch", {
    moduleUrl: "/compiled/main.js",
    params: ["k", "tau", "beta"],
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    prior: {
      k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
      tau: { dist: "normal", mean: 1, sd: 3 },
      beta: { dist: "halfnormal", sd: 2 },
    },
    responseProb,
    toStanData: TO_STAN_DATA,
  });

  assert.throws(
    () => createTimeline({}, { task: "categorical-task", model: "binary-model-for-mismatch" }),
    /responseSpace mismatch/
  );

  registerModel("categorical-count-mismatch-model", {
    moduleUrl: "/compiled/main.js",
    params: ["k"],
    designKeys: DESIGN_KEYS,
    responseSpace: { type: "categorical", n_categories: 2 },
    prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
    responseProbs: () => [0.5, 0.5],
    buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
  });

  assert.throws(
    () => createTimeline({}, { task: "categorical-task", model: "categorical-count-mismatch-model" }),
    /responseSpace category count mismatch/
  );
});

test("createTimeline checks every curated design row for required keys", () => {
  registerTestTask("curated-bad-row-task", {
    design_grid: [
      { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 },
      { t_ss: 0, t_ll: 2, r_ss: 100 },
    ],
  });
  registerModel("curated-bad-row-model", {
    moduleUrl: "/compiled/main.js",
    params: ["k"],
    prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    responseProb: () => 0.5,
    buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
  });

  assert.throws(
    () => createTimeline({}, { task: "curated-bad-row-task", model: "curated-bad-row-model" }),
    /row 1 is missing design key "r_ll"/
  );
});

test("createTimeline rejects bad responseProb and buildData probes", () => {
  registerTestTask("probe-task");
  registerModel("bad-response-prob-model", {
    moduleUrl: "/compiled/main.js",
    params: ["k"],
    prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    responseProb: () => Number.NaN,
    buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
  });
  registerModel("bad-build-data-model", {
    moduleUrl: "/compiled/main.js",
    params: ["k"],
    prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    responseProb: () => 0.5,
    buildData: () => ({ N: 1, y: [undefined] }),
  });

  assert.throws(
    () => createTimeline({}, { task: "probe-task", model: "bad-response-prob-model" }),
    /response likelihood probe failed/
  );
  assert.throws(
    () => createTimeline({}, { task: "probe-task", model: "bad-build-data-model" }),
    /buildData probe returned undefined/
  );
});

test("createAdoTimeline passes completed testlets as batches and refills designs", async () => {
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  const designs = [
    { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 },
    { t_ss: 0, t_ll: 2, r_ss: 100, r_ll: 200 },
    { t_ss: 0, t_ll: 3, r_ss: 100, r_ll: 200 },
  ];
  const seen_batches = [];
  const jsPsych = {
    endExperiment: (message) => {
      throw new Error(message);
    },
  };
  const controller = {
    start: async () => ({
      session_id: "testlet-session",
      trial_index: 0,
      next_design: designs[0],
      next_designs: designs.slice(0, 2),
      next_design_metrics: [{ mutual_info: 0.11 }, { mutual_info: 0.22 }],
      selection_time_ms: 4,
      max_mutual_info: 0.22,
      post_mean: null,
      post_sd: null,
      api_latency_ms: null,
    }),
    update: async (payload) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      seen_batches.push(rows);
      const done = seen_batches.reduce((sum, batch) => sum + batch.length, 0);
      return {
        session_id: "testlet-session",
        trial_index: done,
        next_design: done < designs.length ? designs[done] : null,
        next_designs: done < designs.length ? [designs[done]] : [],
        next_design_metrics: done < designs.length ? [{ mutual_info: 0.30 }] : [],
        selection_time_ms: done < designs.length ? 5 : null,
        max_mutual_info: done < designs.length ? 0.30 : null,
        post_mean: { k: done },
        post_sd: { k: 0.1 },
        api_latency_ms: 1,
      };
    },
  };

  try {
    const timeline = createAdoTimeline(jsPsych, controller, {
      n_trials: 3,
      testlet_size: 2,
      response_labels: { 0: "SS", 1: "LL" },
      presentation: TEST_PRESENTATION,
      choices: ["SS", "LL"],
      task: "demo",
    }, {});

    await new Promise((resolve, reject) => {
      timeline[0].func(resolve);
      setTimeout(() => reject(new Error("timed out waiting for start")), 100);
    });

    timeline[1].on_start({});
    const first = { ...timeline[1].data(), response: 1 };
    timeline[1].on_finish(first);
    assert.equal(first.ado_selection_time_ms, 4);
    assert.equal(first.ado_mutual_info, 0.11);

    timeline[2].on_start({});
    const second = { ...timeline[2].data(), response: 0 };
    timeline[2].on_finish(second);
    assert.equal(second.ado_selection_time_ms, 4);
    assert.equal(second.ado_mutual_info, 0.22);

    const first_update = await new Promise((resolve, reject) => {
      timeline[3].func(resolve);
      setTimeout(() => reject(new Error("timed out waiting for update")), 100);
    });

    timeline[4].on_start({});
    const third = { ...timeline[4].data(), response: 1 };
    timeline[4].on_finish(third);
    assert.equal(third.ado_selection_time_ms, 5);
    assert.equal(third.ado_mutual_info, 0.30);

    const second_update = await new Promise((resolve, reject) => {
      timeline[5].func(resolve);
      setTimeout(() => reject(new Error("timed out waiting for final update")), 100);
    });

    assert.equal(seen_batches.length, 2);
    assert.equal(seen_batches[0].length, 2);
    assert.equal(seen_batches[1].length, 1);
    assert.deepEqual(seen_batches[0].map((row) => row.trial_number), [1, 2]);
    assert.deepEqual(seen_batches[0].map((row) => row.testlet_position), [0, 1]);
    assert.equal(seen_batches[1][0].trial_number, 3);
    assert.equal(seen_batches[1][0].post_mean_k, 2);
    assert.equal(first_update.ado_testlet_size, 2);
    assert.equal(second_update.ado_testlet_size, 1);
    assert.deepEqual(first_update.ado_next_design_metrics, [{ mutual_info: 0.30 }]);
    assert.equal(first_update.ado_selection_time_ms, 5);
    assert.equal(first_update.ado_max_mutual_info, 0.30);
    assert.deepEqual(second_update.ado_next_design_metrics, []);
    assert.equal(second_update.ado_selection_time_ms, null);
    assert.equal(second_update.ado_max_mutual_info, null);
  } finally {
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("Stan controller exposes design-selection diagnostics for ADO testlets", async () => {
  const restoreWorker = installFakeWorker();
  try {
    const controller = createStanAdoController({
      model: {
        params: ["x"],
        prior: { x: { dist: "normal", mean: 0, sd: 1 } },
        moduleUrl: "/fake.js",
        buildData: () => ({ N: 0 }),
        responseProb: (design, draw) => {
          if (design.d === 0) {
            return 0.5;
          }
          return draw.x > 0 ? 0.9 : 0.1;
        },
      },
      grid_design: { d: [0, 1] },
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 13 },
      n_trials: 2,
      testlet_size: 2,
    });

    const state = await controller.start();

    assert.equal(state.next_designs.length, 2);
    assert.equal(state.next_design_metrics.length, 2);
    assert.equal(state.next_design.d, 1);
    assert.equal(state.next_design_metrics[0].mutual_info, state.max_mutual_info);
    assert.ok(state.max_mutual_info > 0);
    assert.ok(state.selection_time_ms >= 0);
  } finally {
    restoreWorker();
  }
});

test("Stan random strategy scores selected designs without claiming max MI", async () => {
  const restoreWorker = installFakeWorker();
  try {
    const controller = createStanAdoController({
      model: {
        params: ["x"],
        prior: { x: { dist: "normal", mean: 0, sd: 1 } },
        moduleUrl: "/fake.js",
        buildData: () => ({ N: 0 }),
        responseProb: () => 0.5,
      },
      grid_design: { d: [0, 1, 2] },
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 23 },
      design_strategy: "random",
      n_trials: 2,
      testlet_size: 2,
    });

    const state = await controller.start();

    assert.equal(state.next_designs.length, 2);
    assert.equal(state.next_design_metrics.length, 2);
    assert.ok(state.next_design_metrics.every(metric => Number.isFinite(metric.mutual_info)));
    assert.equal(state.max_mutual_info, null);
    assert.ok(state.selection_time_ms >= 0);
  } finally {
    restoreWorker();
  }
});

test("buildAdapter reshapes flat {...design, choice} rows to {design, response} generically", () => {
  const seen = [];
  const adapter = buildAdapter({
    name: "reshape-model",
    spec: {
      responseProb,
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      toStanData: (trials) => {
        seen.push(...trials);
        return { N: trials.length };
      },
    },
    paramNames: ["k"],
    prior: { k: { dist: "lognormal", meanlog: 0, sdlog: 1 } },
    moduleUrl: "/x/main.js",
    wasmUrl: "/x/main.hash.wasm",
  });

  // The bundler-emitted wasm URL (#57) must survive into the adapter so the
  // controller can forward it to the worker's locateFile.
  assert.equal(adapter.moduleUrl, "/x/main.js");
  assert.equal(adapter.wasmUrl, "/x/main.hash.wasm");

  // Arbitrary design keys (not DD-shaped) survive the reshape.
  adapter.buildData([
    { a: 1, b: 2, choice: 1 },
    { a: 3, b: 4, choice: 0 },
  ]);
  assert.deepEqual(seen, [
    { design: { a: 1, b: 2 }, response: 1 },
    { design: { a: 3, b: 4 }, response: 0 },
  ]);

  const design = { r_ss: 100, r_ll: 200, t_ll: 1 };
  const draw = { k: 0.01, tau: 1 };
  assert.equal(adapter.responseProb(design, draw), responseProb(design, draw));
});

test("registerModelPackage -> createTimeline forwards wasmUrl to the worker init (bundler-safe, #57)", async () => {
  // End-to-end guard over the whole public path (registerModelPackage -> registry
  // -> buildAdapter -> controller -> worker), because each link previously dropped
  // wasmUrl, silently disabling the #57 fix for anyone using createTimeline.
  const init_messages = [];
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class CapturingWorker {
    postMessage(message) {
      init_messages.push(message);
      queueMicrotask(() => this.onmessage({ data: { type: "ready" } }));
    }
  };
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("wasmurl-task");
    registerModelPackage({
      id: "wasmurl-model",
      params: ["k", "tau"],
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      prior: {
        k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
        tau: { dist: "normal", mean: 1, sd: 3 },
      },
      moduleUrl: "/pkg/main.js",
      wasmUrl: "/pkg/main.deadbeef.wasm",
      buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
      responseProb,
    });

    const timeline = createTimeline({}, {
      task: "wasmurl-task",
      model: "wasmurl-model",
      n_trials: 1,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 7 },
    });

    await new Promise((resolve, reject) => {
      timeline[0].func(resolve);
      setTimeout(() => reject(new Error("timed out waiting for fake worker")), 100);
    });

    const init = init_messages.find((m) => m.type === "init");
    assert.ok(init, "controller never sent a worker init message");
    assert.equal(init.moduleUrl, "/pkg/main.js");
    assert.equal(init.wasmUrl, "/pkg/main.deadbeef.wasm");
  } finally {
    globalThis.Worker = originalWorker;
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("registerTask validates presentation while registerModel stays stats-only", () => {
  assert.throws(
    () => registerTask("no-presentation-task", {
      design_grid: DESIGN_GRID,
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      response_labels: ["SS", "LL"],
    }),
    /presentation/
  );

  assert.throws(
    () => registerTask("no-response-label-task", {
      design_grid: DESIGN_GRID,
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      presentation: TEST_PRESENTATION,
      choices: ["SS", "LL"],
    }),
    /response_labels/
  );

  assert.throws(
    () => registerModel("missing-response-prob", {
      stanCode: STAN_CODE,
      params: ["k"],
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      toStanData: TO_STAN_DATA,
    }),
    /responseProb/
  );
});

test("registerModel rejects stale task-owned fields", () => {
  const base = {
    stanCode: STAN_CODE,
    params: ["k"],
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    responseProb: () => 0.5,
    toStanData: TO_STAN_DATA,
  };

  assert.throws(
    () => registerModel("old-response-mapper", {
      ...base,
      responseToOutcome: () => 1,
    }),
    /responseToOutcome belongs on a task/
  );
  assert.throws(
    () => registerModel("old-task-label", {
      ...base,
      task: "demo",
    }),
    /task belongs on a task/
  );
});

test("moduleUrl registration requires an explicit prior", () => {
  assert.throws(
    () => registerModel("module-needs-prior", {
      moduleUrl: "/compiled/main.js",
      params: ["k"],
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      responseProb: () => 0.5,
      toStanData: TO_STAN_DATA,
    }),
    /Pass an explicit `prior` when registering with `moduleUrl`/
  );
});

test("explicit prior overrides parsed priors", async () => {
  const restoreFetch = installFakeFetch();
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("explicit-prior-task");
    registerModel("explicit-prior-model", {
      stanCode: UNSUPPORTED_STAN_CODE,
      params: ["k"],
      designKeys: DESIGN_KEYS,
      responseSpace: RESPONSE_SPACE,
      prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
      responseProb: () => 0.5,
      toStanData: TO_STAN_DATA,
    });

    await prepareModels({ compileServer: "http://compile.test" });

    const timeline = createTimeline({}, {
      task: "explicit-prior-task",
      model: "explicit-prior-model",
      n_trials: 1,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 19 },
    });

    const start_data = await new Promise((resolve, reject) => {
      timeline[0].func((data) => resolve(data));
      setTimeout(() => reject(new Error("timed out waiting for fake worker")), 100);
    });

    assert.equal(start_data.ado_event, "start");
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("compileStanModel imports from the documented path", () => {
  assert.equal(typeof compileStanModel, "function");
});

test("compileStanModel rejects categorical responseProb-only adapters before compiling", async () => {
  await assert.rejects(
    () => compileStanModel({
      id: "bad-categorical",
      stan: STAN_CODE,
      params: ["k"],
      designKeys: DESIGN_KEYS,
      responseSpace: { type: "categorical", n_categories: 3 },
      prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
      buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
      responseProb: () => 0.5,
      server: "http://compile.test",
    }),
    /categorical models must provide responseProbs/
  );
});

test("labelsToConfig maps arrays to response-index objects", () => {
  assert.deepEqual(labelsToConfig(["SS", "LL"]), { 0: "SS", 1: "LL" });
  const labels = { 0: "short", 1: "long" };
  assert.equal(labelsToConfig(labels), labels);
});

function makePackage(overrides = {}) {
  return {
    id: "pkg-model",
    params: ["k", "tau"],
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    prior: {
      k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
      tau: { dist: "normal", mean: 1, sd: 3 },
    },
    moduleUrl: "/compiled/main.js",
    buildData: (trials) => ({ N: trials.length, y: trials.map((t) => t.choice) }),
    responseProb,
    posterior_display: { k: { label: "k" }, tau: { label: "τ" } },
    ...overrides,
  };
}

test("validateTask flags missing task pieces", () => {
  assert.equal(validateTask({
    id: "task",
    design_grid: DESIGN_GRID,
    designKeys: DESIGN_KEYS,
    responseSpace: RESPONSE_SPACE,
    presentation: TEST_PRESENTATION,
    choices: ["SS", "LL"],
    response_labels: ["SS", "LL"],
  }).valid, true);

  const bad = validateTask({ id: "bad", design_grid: DESIGN_GRID });
  assert.equal(bad.valid, false);
  assert.ok(bad.problems.some((p) => p.level === "error" && /designKeys/.test(p.message)));
  assert.ok(bad.problems.some((p) => p.level === "error" && /presentation/.test(p.message)));
  assert.ok(bad.problems.some((p) => p.level === "error" && /response_labels/.test(p.message)));
});

test("validateModel flags missing pieces, missing priors, and unsampleable prior families", () => {
  assert.equal(validateModel(makePackage()).valid, true);

  const bad = validateModel({
    id: "b",
    params: ["k"],
    prior: { k: { dist: "lognormal", meanlog: 0, sdlog: 1 } },
    moduleUrl: "/m/main.js",
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.problems.some((p) => p.level === "error" && /responseProb/.test(p.message)));
  assert.ok(bad.problems.some((p) => p.level === "error" && /buildData/.test(p.message)));
  assert.ok(bad.problems.some((p) => p.level === "error" && /designKeys/.test(p.message)));

  const stale = validateModel(makePackage({ responseToOutcome: () => 1, task: "demo" }));
  assert.equal(stale.valid, false);
  assert.ok(stale.problems.some((p) => p.level === "error" && /responseToOutcome/.test(p.message)));
  assert.ok(stale.problems.some((p) => p.level === "error" && /task/.test(p.message)));

  // A prior the first-design sampler can't draw is a warning, not an error.
  const warned = validateModel(makePackage({ prior: { k: { dist: "gamma", alpha: 2, beta: 3 }, tau: { dist: "normal", mean: 0, sd: 1 } } }));
  assert.equal(warned.valid, true);
  assert.ok(warned.problems.some((p) => p.level === "warn" && /can't draw/.test(p.message)));

  // A parameter with no prior entry is an error (the engine samples the prior first).
  const missingPrior = validateModel(makePackage({ prior: { k: { dist: "normal", mean: 0, sd: 1 } } }));
  assert.equal(missingPrior.valid, false);
  assert.ok(missingPrior.problems.some((p) => p.level === "error" && /tau/.test(p.message)));
});

test("validateModel warns (not errors) when a model package omits wasmUrl (#57)", () => {
  // A package can be served statically without wasmUrl (sibling resolution), but a
  // bundler would 404 the hashed wasm — so it's a warning, not a hard error.
  const without = validateModel(makePackage());
  assert.equal(without.valid, true);
  assert.ok(without.problems.some((p) => p.level === "warn" && /wasmUrl/.test(p.message)));

  const withWasm = validateModel(makePackage({ wasmUrl: "/compiled/main.wasm" }));
  assert.equal(withWasm.valid, true);
  assert.ok(!withWasm.problems.some((p) => /wasmUrl/.test(p.message)));
});

test("validateModel rejects malformed categorical responseProbs", () => {
  const categorical = (responseProbs) => makePackage({
    responseSpace: { type: "categorical", n_categories: 3 },
    responseProb: undefined,
    responseProbs,
  });
  const sampleDesign = { t_ss: 0, t_ll: 1, r_ss: 100, r_ll: 200 };

  assert.equal(validateModel(categorical(() => [0.5, 0.25, 0.25]), {
    sampleDesign,
    sampleDraw: { k: 0.01, tau: 1 },
  }).valid, true);

  for (const probs of [
    [0.5, 0.5],
    [2, 1, 1],
    [0.5, Number.NaN, 0.5],
    [0.5, -0.1, 0.6],
  ]) {
    const result = validateModel(categorical(() => probs), {
      sampleDesign,
      sampleDraw: { k: 0.01, tau: 1 },
    });
    assert.equal(result.valid, false, `expected invalid model for ${JSON.stringify(probs)}`);
    assert.ok(result.problems.some((p) => p.level === "error" && /response likelihood/.test(p.message)));
  }
});

test("registerModelPackage rejects invalid packages and design_grid overrides", () => {
  assert.throws(
    () => registerModelPackage(
      { id: "invalid-pkg", params: ["k"], prior: { k: { dist: "lognormal", meanlog: 0, sdlog: 1 } }, moduleUrl: "/m/main.js" }
    ),
    /invalid model package/
  );

  assert.throws(
    () => registerModelPackage(makePackage({ id: "old-grid-pkg" }), { design_grid: DESIGN_GRID }),
    /design_grid belongs on a task/
  );
});

test("registerModelPackage forwards testlet_size as a timeline default", async () => {
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  try {
    registerTestTask("pkg-testlet-task", {
      design_grid: TESTLET_DESIGN_GRID,
    });
    const name = registerModelPackage(makePackage({ id: "pkg-testlet-default" }), {
      n_trials: 5,
      testlet_size: 2,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 3 },
    });

    const timeline = createTimeline({}, { task: "pkg-testlet-task", model: name });
    const choices = timeline.filter((t) => t.type === "html-button-response");
    const calls = timeline.filter((t) => t.type === "call-function");
    assert.equal(choices.length, 5);
    assert.equal(calls.length - 1, 3);
  } finally {
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("registerModelPackage registers a package and wires responseProb(design, draw)", async () => {
  const restoreWorker = installFakeWorker();
  globalThis.jsPsychCallFunction = "call-function";
  globalThis.jsPsychHtmlButtonResponse = "html-button-response";

  const seen = [];
  try {
    registerTestTask("pkg-order-task");
    const pkg = makePackage({
      id: "pkg-order",
      responseProb: (design, draw) => {
        seen.push({ design, draw });
        return responseProb(design, draw);
      },
    });

    const name = registerModelPackage(pkg, {
      n_trials: 1,
      stan: { num_chains: 1, num_warmup: 0, num_samples: 1, seed: 3 },
    });
    assert.equal(name, "pkg-order");

    const timeline = createTimeline({}, { task: "pkg-order-task", model: "pkg-order" });
    await new Promise((resolve, reject) => {
      timeline[0].func((d) => resolve(d));
      setTimeout(() => reject(new Error("timed out waiting for fake worker")), 100);
    });

    assert.ok(seen.length > 0, "responseProb should run during compatibility or design selection");
    const { design, draw } = seen[0];
    assert.ok("r_ss" in design && "t_ll" in design, "first arg should be the design");
    assert.ok("k" in draw && "tau" in draw, "second arg should be the parameter draw");
    assert.equal(timeline[1].data().task, "pkg-order-task");
  } finally {
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});
