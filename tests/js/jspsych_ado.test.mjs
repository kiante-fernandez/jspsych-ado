import { test } from "node:test";
import assert from "node:assert/strict";

import { createAdoTimeline } from "../../src/ado/ado_timeline.js";
import {
  createController,
  labelsToConfig,
  parseStanPriors,
  validateModel,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Multi-valued grid ON PURPOSE: several regression tests assert that the design a
// trial RENDERS is the design its data row RECORDS (a single-design grid can never
// catch a stale-design bug).
const DESIGN_GRID = {
  t_ss: [0],
  t_ll: [1, 2, 3, 4, 5],
  r_ss: [100, 150],
  r_ll: [200],
};

const DESIGN_KEYS = ["t_ss", "t_ll", "r_ss", "r_ll"];

function responseProb(design, theta) {
  const gap = design.r_ll - design.r_ss - theta.k * design.t_ll;
  return 1 / (1 + Math.exp(-theta.tau * gap));
}

function makeModel(overrides = {}) {
  return {
    id: "test_hyperbolic",
    params: ["k", "tau"],
    designKeys: DESIGN_KEYS,
    responseSpace: { type: "binary" },
    prior: {
      k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
      tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
    },
    moduleUrl: "https://example.test/main.js",
    wasmUrl: "https://example.test/main.wasm",
    stanData: { t_ss: "t_ss", t_ll: "t_ll", r_ss: "r_ss", r_ll: "r_ll", y: "choice" },
    responseProb,
    ...overrides,
  };
}

function makeJsPsych() {
  return {
    aborted: null,
    abortExperiment(html, data) {
      this.aborted = { html, data };
    },
  };
}

// Drive a returned timeline fragment the way jsPsych 8 does: function-valued
// parameters are resolved BEFORE on_start (processParameters -> onStart -> plugin ->
// await onFinish). respond(trial_number, trial, resolved) supplies the plugin data row.
async function runFragment(fragment, respond) {
  const root = fragment[0];
  if (root.on_timeline_start) root.on_timeline_start();
  const rows = [];
  const rendered = [];
  let step = 0;
  for (const node of root.timeline) {
    if (node.conditional_function && !node.conditional_function()) continue;
    for (const t of node.timeline) {
      const resolved = {};
      for (const key of ["stimulus", "choices", "data", "simulation_options"]) {
        resolved[key] = typeof t[key] === "function" ? t[key]() : t[key];
      }
      if (t.on_start) t.on_start(t);
      rendered.push(resolved);
      const data = respond ? respond(step, t, resolved) : { response: 1 };
      if (t.on_finish) await t.on_finish(data);
      rows.push(data);
      step += 1;
    }
  }
  if (root.on_timeline_finish) root.on_timeline_finish();
  return { rows, rendered };
}

// A fake Worker servicing the stan controller's protocol: init -> ack; sample ->
// posterior draw columns. `gate` (when provided) delays sample responses until
// released, so tests can assert that on_finish truly awaits the model update.
function installFakeWorker({ gate = null, capture = null, draws = null } = {}) {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class FakeWorker {
    postMessage(message) {
      if (capture) capture.push(message);
      const respond = () => {
        if (message.type === "init") {
          this.onmessage({ data: { type: "inited" } });
        } else {
          this.onmessage({
            data: {
              type: "draws",
              draws: draws ?? { k: [0.01, 0.02, 0.03, 0.04], tau: [1, 1.1, 0.9, 1.2] },
            },
          });
        }
      };
      if (gate && message.type === "sample") {
        gate.push(respond);
      } else {
        queueMicrotask(respond);
      }
    }
  };
  return () => {
    globalThis.Worker = originalWorker;
  };
}

// ---------------------------------------------------------------------------
// parseStanPriors (kept regressions: #6 comments, #7 half-normal bounds)
// ---------------------------------------------------------------------------

const STAN_CODE = `
data { int<lower=0> N; }
parameters {
  real<lower=0> k;
  real tau;
  // beta ~ normal(9, 9);  (commented out on purpose, #6)
  real<lower=0> beta;
}
model {
  k ~ lognormal(-4, 2);
  tau ~ normal(1, 3);
  beta ~ normal(0, 2);
}
`;

test("parseStanPriors: derives lognormal / normal / half-normal specs", () => {
  const prior = parseStanPriors(STAN_CODE, ["k", "tau", "beta"]);
  assert.deepEqual(prior.k, { dist: "lognormal", meanlog: -4, sdlog: 2 });
  assert.deepEqual(prior.tau, { dist: "normal", mean: 1, sd: 3 });
  assert.deepEqual(prior.beta, { dist: "halfnormal", sd: 2 }); // <lower=0> + zero-mean normal
});

test("parseStanPriors: ignores commented-out sampling statements (#6)", () => {
  const prior = parseStanPriors(STAN_CODE, ["beta"]);
  assert.deepEqual(prior.beta, { dist: "halfnormal", sd: 2 });
});

test("parseStanPriors: lower=0.5 is NOT half-normal (#7)", () => {
  const code = `
parameters { real<lower=0.5> w; }
model { w ~ normal(0, 1); }
`;
  const prior = parseStanPriors(code, ["w"]);
  assert.deepEqual(prior.w, { dist: "normal", mean: 0, sd: 1 });
});

test("parseStanPriors: wrong arity is rejected with guidance", () => {
  const code = `
parameters { real k; }
model { k ~ normal(1); }
`;
  assert.throws(() => parseStanPriors(code, ["k"]), /expects 2 numeric arguments/);
});

// ---------------------------------------------------------------------------
// createController validation
// ---------------------------------------------------------------------------

test("createController: requires model and design_grid", () => {
  assert.throws(() => createController(makeJsPsych(), {}), /provide a model package/);
  assert.throws(
    () => createController(makeJsPsych(), { model: makeModel() }),
    /design_grid.*required/,
  );
});

test("createController: rejects a grid missing a model design key", () => {
  assert.throws(
    () =>
      createController(makeJsPsych(), {
        model: makeModel(),
        design_grid: { t_ll: [1], r_ss: [100], r_ll: [200] }, // t_ss missing
      }),
    /missing model design key "t_ss"/,
  );
});

test("createController: rejects an empty design grid", () => {
  assert.throws(
    () =>
      createController(makeJsPsych(), {
        model: makeModel(),
        design_grid: { t_ss: [], t_ll: [1], r_ss: [100], r_ll: [200] },
      }),
    /no candidate designs/,
  );
});

test("validateModel: rejects task-owned fields on a model package", () => {
  const { valid, problems } = validateModel(makeModel({ choices: ["a", "b"] }));
  assert.equal(valid, false);
  assert.ok(problems.some((p) => /belongs in experiment\/trial code/.test(p.message)));
});

// ---------------------------------------------------------------------------
// Core mock-mode flow through the PUBLIC API
// ---------------------------------------------------------------------------

test("mock run: rendered stimulus always matches the recorded design (stale-design regression)", async () => {
  const jsPsych = makeJsPsych();
  const ado = createController(jsPsych, {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const trial = {
    type: "html-button-response",
    stimulus: () => `${ado.evaluateDesignVariable("t_ll")}|${ado.evaluateDesignVariable("r_ss")}`,
    choices: ["SS", "LL"],
    on_finish: (data) => ado.recordResponse(data.response),
  };
  const { rows, rendered } = await runFragment(
    ado.createTimeline(trial, { n_trials: 5, debug: false }),
    () => ({ response: 1 }),
  );

  assert.equal(rows.length, 5);
  rows.forEach((row, i) => {
    assert.equal(
      rendered[i].stimulus,
      `${row.ado_design.t_ll}|${row.ado_design.r_ss}`,
      `trial ${i} rendered the design its row recorded`,
    );
  });
  // The mock walks the grid deterministically; designs must actually change.
  assert.ok(new Set(rendered.map((r) => r.stimulus)).size > 1, "designs advance across trials");
  assert.equal(jsPsych.aborted, null);
});

test("mock run: rows carry the ADO data schema", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const trial = {
    type: "html-button-response",
    stimulus: "s",
    choices: ["SS", "LL"],
    on_finish: (data) => ado.recordResponse(data.response),
  };
  const { rows } = await runFragment(
    ado.createTimeline(trial, { n_trials: 2, debug: false }),
    () => ({
      response: 0,
    }),
  );

  const row = rows[0];
  assert.equal(row.choice, 0);
  assert.equal(row.choice_label, "SS"); // inferred from the trial's static choices
  assert.equal(row.controller_mode, "mock");
  assert.equal(row.design_strategy, null);
  assert.equal(row.model_id, "test_hyperbolic");
  assert.equal(row.ado_event, "update");
  assert.equal(typeof row.ado_trial_index, "number");
  assert.equal(typeof row.post_mean_k, "number");
  assert.equal(typeof row.post_sd_k, "number");
  assert.equal(row.trial_number, 1);
  assert.equal(row.testlet_index, 0);
  assert.ok(row.ado_design && typeof row.ado_design.t_ll === "number");
  assert.equal(Object.hasOwn(row, "__ado_response"), false, "internal field is not saved");
});

test("response_labels: explicit labels win; mismatched counts throw", () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const trial = { type: "x", stimulus: "s", choices: ["a", "b"], on_finish: () => {} };
  assert.throws(
    () => ado.createTimeline(trial, { response_labels: ["one", "two", "three"], debug: false }),
    /response_labels has 3 entries; expected 2/,
  );
  // One inferred label from a 1-button trial also fails against a binary model.
  const one_button = { type: "x", stimulus: "s", choices: ["only"], on_finish: () => {} };
  assert.throws(
    () => ado.createTimeline(one_button, { debug: false }),
    /has 1 entries; expected 2/,
  );
});

// ---------------------------------------------------------------------------
// recordResponse contract
// ---------------------------------------------------------------------------

test("recordResponse: gated to on_finish, single-shot, and validated against the response space", async () => {
  const jsPsych = makeJsPsych();
  const ado = createController(jsPsych, {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });

  // Outside any trial: throws.
  assert.throws(() => ado.recordResponse(1), /no adaptive run is active/);

  // Double call inside on_finish: throws.
  const double = {
    type: "x",
    stimulus: "s",
    choices: ["a", "b"],
    on_finish: () => {
      ado.recordResponse(1);
      ado.recordResponse(1);
    },
  };
  const frag = ado.createTimeline(double, { n_trials: 1, debug: false });
  frag[0].on_timeline_start();
  await assert.rejects(
    () => frag[0].timeline[0].timeline[0].on_finish({}),
    /only one response can be recorded/,
  );

  // Out-of-range and non-integer values: rejected with mapping guidance.
  for (const bad of [2, -1, 0.5, "left", null, undefined]) {
    const ado2 = createController(makeJsPsych(), {
      model: makeModel(),
      design_grid: DESIGN_GRID,
      controller: "mock",
    });
    const t = {
      type: "x",
      stimulus: "s",
      choices: ["a", "b"],
      on_finish: (d) => ado2.recordResponse(d.response),
    };
    const f = ado2.createTimeline(t, { n_trials: 1, debug: false });
    f[0].on_timeline_start();
    await assert.rejects(
      () => f[0].timeline[0].timeline[0].on_finish({ response: bad }),
      /integer outcome in 0\.\.1/,
      `rejects ${JSON.stringify(bad)}`,
    );
  }
});

test("forgotten recordResponse: on_finish rejects AND the experiment aborts visibly", async () => {
  const jsPsych = makeJsPsych();
  const ado = createController(jsPsych, {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const trial = { type: "x", stimulus: "s", choices: ["a", "b"], on_finish: () => {} };
  const frag = ado.createTimeline(trial, { n_trials: 1, debug: false });
  frag[0].on_timeline_start();
  const data = {};
  await assert.rejects(
    () => frag[0].timeline[0].timeline[0].on_finish(data),
    /without calling ado\.recordResponse/,
  );
  assert.ok(jsPsych.aborted, "abortExperiment was called");
  assert.match(jsPsych.aborted.data.ado_error, /recordResponse/);
  assert.equal(data.ado_event, "error");
});

test("user mapping owns raw->outcome: mapped value is the choice, raw response survives", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  // A keyboard-ish trial whose raw response is a key string, mapped in user code.
  const keymap = { f: 0, j: 1 };
  const trial = {
    type: "keyboard",
    stimulus: "s",
    on_finish: (data) => ado.recordResponse(keymap[data.response]),
  };
  const { rows } = await runFragment(
    ado.createTimeline(trial, { n_trials: 1, response_labels: ["SS", "LL"], debug: false }),
    () => ({ response: "j" }),
  );
  assert.equal(rows[0].response, "j"); // plugin's raw response untouched
  assert.equal(rows[0].choice, 1); // mapped model outcome
  assert.equal(rows[0].choice_label, "LL");
});

// ---------------------------------------------------------------------------
// Stan mode through the fake worker
// ---------------------------------------------------------------------------

test("stan run: on_finish is not resolved until the sample completes; next trial sees the new design", async () => {
  const gate = [];
  const restore = installFakeWorker({ gate });
  try {
    const ado = createController(makeJsPsych(), {
      model: makeModel(),
      design_grid: DESIGN_GRID,
      stan: { num_chains: 1, num_warmup: 10, num_samples: 10, seed: 1 },
    });
    const trial = {
      type: "html-button-response",
      stimulus: () => `${ado.evaluateDesignVariable("t_ll")}|${ado.evaluateDesignVariable("r_ss")}`,
      choices: ["SS", "LL"],
      on_finish: (data) => ado.recordResponse(data.response),
    };
    const frag = ado.createTimeline(trial, { n_trials: 2, debug: false });
    frag[0].on_timeline_start();

    const t1 = frag[0].timeline[0].timeline[0];
    const stim1 = t1.stimulus();
    t1.on_start(t1);
    const row1 = { response: 1 };
    let finished = false;
    const pending = t1.on_finish(row1).then(() => {
      finished = true;
    });
    // Let microtasks run: the update must be waiting on the gated sample.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(finished, false, "on_finish must await the Stan sample");
    assert.equal(gate.length, 1, "one sample request in flight");
    gate.shift()(); // release the posterior
    await pending;
    assert.equal(finished, true);
    assert.equal(typeof row1.post_mean_k, "number");
    assert.equal(stim1, `${row1.ado_design.t_ll}|${row1.ado_design.r_ss}`);

    // Trial 2 renders the design chosen by the update, not trial 1's design.
    const t2 = frag[0].timeline[1].timeline[0];
    const stim2 = t2.stimulus();
    t2.on_start(t2);
    assert.equal(stim2, `${row1.ado_next_design.t_ll}|${row1.ado_next_design.r_ss}`);
  } finally {
    restore();
  }
});

test("stan run: worker init receives moduleUrl AND wasmUrl (#57 regression)", async () => {
  const capture = [];
  const restore = installFakeWorker({ capture });
  try {
    const ado = createController(makeJsPsych(), {
      model: makeModel(),
      design_grid: DESIGN_GRID,
      stan: { num_chains: 1, num_warmup: 10, num_samples: 10, seed: 1 },
    });
    const trial = {
      type: "x",
      stimulus: "s",
      choices: ["a", "b"],
      on_finish: (d) => ado.recordResponse(d.response),
    };
    const frag = ado.createTimeline(trial, { n_trials: 1, debug: false });
    frag[0].on_timeline_start();
    await frag[0].timeline[0].timeline[0].on_finish({ response: 0 });

    const init = capture.find((m) => m.type === "init");
    assert.ok(init, "an init message was posted");
    assert.equal(init.moduleUrl, "https://example.test/main.js");
    assert.equal(init.wasmUrl, "https://example.test/main.wasm");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Testlets through the PUBLIC API (the in-testlet design advance)
// ---------------------------------------------------------------------------

test("testlet_size=2: each trial inside a testlet renders its OWN design; one update per boundary", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const trial = {
    type: "html-button-response",
    stimulus: () => `${ado.evaluateDesignVariable("t_ll")}|${ado.evaluateDesignVariable("r_ss")}`,
    choices: ["SS", "LL"],
    on_finish: (data) => ado.recordResponse(data.response),
  };
  const { rows, rendered } = await runFragment(
    ado.createTimeline(trial, { n_trials: 4, testlet_size: 2, debug: false }),
    () => ({ response: 1 }),
  );

  assert.equal(rows.length, 4);
  rows.forEach((row, i) => {
    assert.equal(
      rendered[i].stimulus,
      `${row.ado_design.t_ll}|${row.ado_design.r_ss}`,
      `testlet trial ${i} rendered its own design`,
    );
    assert.equal(row.testlet_index, Math.floor(i / 2));
    assert.equal(row.testlet_position, i % 2);
    assert.equal(row.ado_testlet_size, 2);
  });
  // The mock's testlet designs differ within a batch — the in-testlet advance is real.
  assert.notEqual(rendered[0].stimulus, rendered[1].stimulus);
  // Update fields land on BOTH rows of a batch, with the same post-update index.
  assert.equal(rows[0].ado_trial_index, rows[1].ado_trial_index);
  assert.equal(rows[0].ado_trial_index, 2);
  assert.equal(rows[2].ado_trial_index, 4);
});

// ---------------------------------------------------------------------------
// Early stopping through the timeline (#21 regression, restored)
// ---------------------------------------------------------------------------

test("createAdoTimeline skips remaining testlets once the controller signals should_stop (#21)", async () => {
  let updates = 0;
  const scripted_controller = {
    start: () => ({
      session_id: "s",
      trial_index: 0,
      next_design: { d: 1 },
      next_designs: [{ d: 1 }],
      should_stop: false,
      post_mean: null,
      post_sd: null,
    }),
    update: async () => {
      updates += 1;
      return {
        session_id: "s",
        trial_index: updates,
        next_design: { d: updates + 1 },
        next_designs: [{ d: updates + 1 }],
        should_stop: updates >= 2, // stop after the second refit
        stop_reason: updates >= 2 ? "eig_below_threshold" : null,
        post_mean: { k: 0.1 },
        post_sd: { k: 0.01 },
      };
    },
  };

  const fragment = createAdoTimeline(
    makeJsPsych(),
    scripted_controller,
    {
      n_trials: 6,
      response_labels: { 0: "a", 1: "b" },
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
    },
    { debug: false },
  );

  const { rows } = await runFragment(fragment, () => ({}));
  assert.equal(rows.length, 2, "trials 3..6 were skipped after should_stop");
  assert.equal(updates, 2);
  assert.equal(rows[1].ado_should_stop, true);
  assert.equal(rows[1].ado_stop_reason, "eig_below_threshold");
});

// ---------------------------------------------------------------------------
// Multi-trial steps, factory form, reuse, cloning
// ---------------------------------------------------------------------------

test("array form: prelude trials read the design; the LAST trial is the response by default", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const fixation = { type: "fixation", stimulus: "+" };
  const show = { type: "canvas", stimulus: () => `see ${ado.evaluateDesignVariable("t_ll")}` };
  const respond = {
    type: "response",
    stimulus: "?",
    choices: ["SS", "LL"],
    on_finish: (d) => ado.recordResponse(d.response),
  };
  const { rows } = await runFragment(
    ado.createTimeline([fixation, show, respond], { n_trials: 2, debug: false }),
    (step) => (step % 3 === 2 ? { response: 1 } : {}),
  );
  const ado_rows = rows.filter((r) => r.ado_event === "update");
  assert.equal(ado_rows.length, 2);
  assert.equal(rows.length, 6);
  assert.equal(ado_rows[0].choice_label, "LL");
});

test("factory form: the factory runs per adaptive step and can read ctx", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const seen_trial_numbers = [];
  const factory = (ctx) => {
    seen_trial_numbers.push(ctx.trial_number);
    return {
      type: "x",
      stimulus: () => `n${ctx.trial_number}:${ctx.ado.evaluateDesignVariable("t_ll")}`,
      choices: ["SS", "LL"],
      on_finish: (d) => ctx.ado.recordResponse(d.response),
    };
  };
  const { rows } = await runFragment(
    ado.createTimeline(factory, { n_trials: 3, debug: false }),
    () => ({
      response: 0,
    }),
  );
  assert.deepEqual(seen_trial_numbers, [1, 2, 3]);
  assert.equal(rows.length, 3);
});

test("createTimeline does not mutate the user's trial objects", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const user_on_finish = (d) => ado.recordResponse(d.response);
  const trial = { type: "x", stimulus: "s", choices: ["a", "b"], on_finish: user_on_finish };
  const frag = ado.createTimeline(trial, { n_trials: 2, debug: false });
  assert.equal(trial.on_finish, user_on_finish, "user's on_finish untouched");
  assert.equal(trial.on_start, undefined, "no injected on_start on the user object");
  assert.equal(Object.hasOwn(trial, "__ado_is_response"), false);
  await runFragment(frag, () => ({ response: 1 }));
  assert.equal(trial.on_finish, user_on_finish);
});

test("controller reuse: a second createTimeline run works after the first (practice -> main)", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const make_trial = () => ({
    type: "x",
    stimulus: () => `${ado.evaluateDesignVariable("t_ll")}`,
    choices: ["SS", "LL"],
    on_finish: (d) => ado.recordResponse(d.response),
  });
  const practice = ado.createTimeline(make_trial(), { n_trials: 2, debug: false });
  const main = ado.createTimeline(make_trial(), { n_trials: 3, debug: false });

  const practice_run = await runFragment(practice, () => ({ response: 1 }));
  const main_run = await runFragment(main, () => ({ response: 0 }));

  assert.equal(practice_run.rows.length, 2);
  assert.equal(main_run.rows.length, 3);
  // Each run's rows are internally consistent (rendered design == recorded design).
  main_run.rows.forEach((row, i) => {
    assert.equal(main_run.rendered[i].stimulus, String(row.ado_design.t_ll));
  });
});

// ---------------------------------------------------------------------------
// Simulation hook (the old ?simulate= contract, re-homed)
// ---------------------------------------------------------------------------

test("simulate: composes simulation_options drawing responses from the model likelihood", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const trial = {
    type: "html-button-response",
    stimulus: "s",
    choices: ["SS", "LL"],
    on_finish: (d) => ado.recordResponse(d.response),
  };
  const frag = ado.createTimeline(trial, {
    n_trials: 2,
    debug: false,
    simulate: { participant: { k: 0.02, tau: 1.5 }, rt_ms: 250, seed: 7 },
  });
  frag[0].on_timeline_start();

  const t1 = frag[0].timeline[0].timeline[0];
  assert.equal(typeof t1.simulation_options, "function");
  const sim = t1.simulation_options();
  assert.ok(sim.data, "simulation supplies plugin data");
  assert.ok(sim.data.response === 0 || sim.data.response === 1);
  assert.equal(sim.data.rt, 250);
  assert.equal(sim.data.sim_k, 0.02);

  // Run the trial with the simulated response; sim_* audit fields land on the row.
  if (t1.on_start) t1.on_start(t1);
  const data = { response: sim.data.response };
  await t1.on_finish(data);
  assert.equal(data.sim_k, 0.02);
  assert.equal(data.choice, sim.data.response);
});

// ---------------------------------------------------------------------------
// Misc facade helpers
// ---------------------------------------------------------------------------

test("labelsToConfig converts arrays and passes objects through", () => {
  assert.deepEqual(labelsToConfig(["SS", "LL"]), { 0: "SS", 1: "LL" });
  assert.deepEqual(labelsToConfig({ 0: "x" }), { 0: "x" });
});

test("getState exposes the live controller state to user code", async () => {
  const ado = createController(makeJsPsych(), {
    model: makeModel(),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  const states = [];
  const trial = {
    type: "x",
    stimulus: "s",
    choices: ["a", "b"],
    on_finish: (d) => {
      ado.recordResponse(d.response);
      states.push(ado.getState());
    },
  };
  await runFragment(ado.createTimeline(trial, { n_trials: 2, debug: false }), () => ({
    response: 1,
  }));
  assert.equal(states.length, 2);
  // Inside on_finish (before the update resolves) the state is the pre-update one;
  // by trial 2 it carries the first update's posterior.
  assert.equal(states[0].post_mean, null);
  assert.equal(typeof states[1].post_mean.k, "number");
});
