import { test } from "node:test";
import assert from "node:assert/strict";

import { samplePriorDraws } from "../../experiments/delay_discounting/ado/mi_engine.js";
import { createSeededRng } from "../../experiments/delay_discounting/dd_simulation.js";
import { compileStanModel } from "../../experiments/delay_discounting/models/compile_stan_model.js";
import {
  createTimeline,
  labelsToConfig,
  parseStanPriors,
  prepareModels,
  registerModel,
} from "../../experiments/delay_discounting/jspsych_ado.js";

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

const TO_STAN_DATA = (trials) => ({
  N: trials.length,
  y: trials.map((trial) => trial.response),
});

function linkProb(theta, design) {
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

function registerTestModel(name, overrides = {}) {
  registerModel(name, {
    stanCode: STAN_CODE,
    params: ["k", "tau", "beta"],
    design_grid: DESIGN_GRID,
    linkProb,
    toStanData: TO_STAN_DATA,
    response_labels: ["SS", "LL"],
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
    registerModel("stan-url-model", {
      stanUrl: "/models/test-model.stan",
      params: ["k", "tau", "beta"],
      design_grid: DESIGN_GRID,
      linkProb,
      toStanData: TO_STAN_DATA,
      response_labels: ["SS", "LL"],
    });

    await prepareModels({ compileServer: "http://compile.test" });

    const timeline = createTimeline({}, {
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
    assert.equal(typeof timeline[1].data().t_ss, "number");
  } finally {
    restoreFetch();
    restoreWorker();
    delete globalThis.jsPsychCallFunction;
    delete globalThis.jsPsychHtmlButtonResponse;
  }
});

test("moduleUrl registration requires an explicit prior", () => {
  assert.throws(
    () => registerModel("module-needs-prior", {
      moduleUrl: "/compiled/main.js",
      params: ["k"],
      design_grid: DESIGN_GRID,
      linkProb,
      toStanData: TO_STAN_DATA,
      response_labels: ["SS", "LL"],
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
    registerTestModel("explicit-prior-model", {
      stanCode: UNSUPPORTED_STAN_CODE,
      params: ["k"],
      prior: { k: { dist: "lognormal", meanlog: -4, sdlog: 2 } },
    });

    await prepareModels({ compileServer: "http://compile.test" });

    const timeline = createTimeline({}, {
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

test("labelsToConfig maps arrays to response-index objects", () => {
  assert.deepEqual(labelsToConfig(["SS", "LL"]), { 0: "SS", 1: "LL" });
  const labels = { 0: "short", 1: "long" };
  assert.equal(labelsToConfig(labels), labels);
});
