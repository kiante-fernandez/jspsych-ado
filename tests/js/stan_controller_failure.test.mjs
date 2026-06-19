// Failure-path tests for the Stan ADO controller. These are the recovery branches
// that decide whether a worker/sampling failure surfaces a clear error vs hangs
// the experiment forever. They run under `node --test` (no real WASM): a scripted
// fake Worker drives each failure mode, and the construction-time guards need no
// worker at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStanAdoController } from "../../jspsych-ado/controllers/stan_ado_controller.js";

// A binary model stub sufficient for the controller (params/prior/buildData/responseProb).
function makeModel() {
  return {
    params: ["x"],
    prior: { x: { dist: "normal", mean: 0, sd: 1 } },
    moduleUrl: "/fake.js",
    wasmUrl: "/fake.wasm",
    buildData: (trials) => ({ N: trials.length, x: trials.map(() => 0), y: trials.map((t) => t.choice) }),
    responseProb: () => 0.5,
  };
}

// Replace globalThis.Worker with one whose response to each postMessage(message) is
// decided by `handler(message, port)`. `port` can deliver a message, fire the
// worker's error/messageerror, or hang (never respond).
function installScriptedWorker(handler) {
  const original = globalThis.Worker;
  globalThis.Worker = class ScriptedWorker {
    postMessage(message) {
      const port = {
        message: (data) => queueMicrotask(() => this.onmessage && this.onmessage({ data })),
        error: (msg) => queueMicrotask(() => this.onerror && this.onerror({ message: msg })),
        messageerror: () => queueMicrotask(() => this.onmessageerror && this.onmessageerror({})),
        hang: () => {},
      };
      handler(message, port);
    }
    terminate() {}
  };
  return () => { globalThis.Worker = original; };
}

const baseArgs = (model) => ({ model, grid_design: { d: [0, 1] }, n_trials: 2 });

test("construction rejects num_chains < 1", () => {
  assert.throws(
    () => createStanAdoController({ ...baseArgs(makeModel()), stan: { num_chains: 0, num_warmup: 0, num_samples: 1 } }),
    /num_chains>=1/
  );
});

test("construction rejects num_warmup < 0", () => {
  assert.throws(
    () => createStanAdoController({ ...baseArgs(makeModel()), stan: { num_chains: 1, num_warmup: -1, num_samples: 1 } }),
    /num_warmup>=0/
  );
});

test("construction rejects num_samples < 1", () => {
  assert.throws(
    () => createStanAdoController({ ...baseArgs(makeModel()), stan: { num_chains: 1, num_warmup: 0, num_samples: 0 } }),
    /num_samples>=1/
  );
});

test("worker onerror rejects start() with a clear load-failure message", async () => {
  const restore = installScriptedWorker((_message, port) => port.error("module not found"));
  try {
    const controller = createStanAdoController(baseArgs(makeModel()));
    await assert.rejects(controller.start(), /Stan worker failed to load: module not found/);
  } finally {
    restore();
  }
});

test("worker onmessageerror rejects with a deserialization message", async () => {
  const restore = installScriptedWorker((_message, port) => port.messageerror());
  try {
    const controller = createStanAdoController(baseArgs(makeModel()));
    await assert.rejects(controller.start(), /message could not be deserialized/);
  } finally {
    restore();
  }
});

test("empty draw columns reject update() with 'no posterior draws'", async () => {
  const restore = installScriptedWorker((message, port) => {
    if (message.type === "init") {
      port.message({ type: "ok" });
    } else {
      port.message({ draws: { x: [] } }); // sample returned zero draws
    }
  });
  try {
    const controller = createStanAdoController(baseArgs(makeModel()));
    await controller.start();
    await assert.rejects(
      controller.update({ ado_design: { d: 0 }, choice: 0 }),
      /Stan returned no posterior draws/
    );
  } finally {
    restore();
  }
});

test("a second in-flight request is rejected instead of clobbering the first", async () => {
  // init resolves; the sample request hangs, so the first update keeps the single
  // pending slot and a concurrent second update must fail loudly.
  const restore = installScriptedWorker((message, port) => {
    if (message.type === "init") {
      port.message({ type: "ok" });
    } else {
      port.hang();
    }
  });
  try {
    const controller = createStanAdoController(baseArgs(makeModel()));
    await controller.start();
    const first = controller.update({ ado_design: { d: 0 }, choice: 0 });
    first.catch(() => {}); // first never settles (worker hangs); avoid an unhandled rejection
    const second = controller.update({ ado_design: { d: 1 }, choice: 1 });
    await assert.rejects(second, /while one was already in flight/);
  } finally {
    restore();
  }
});
