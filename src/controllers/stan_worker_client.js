// Web Worker transport for the in-browser Stan controller.
//
// Owns the worker lifecycle and a SINGLE in-flight request slot: requests are strictly
// sequential (one init, then one awaited sample per trial), so one slot is enough. The
// controller above it only sees init()/sample() promises and never touches the worker,
// postMessage, or the onmessage/onerror plumbing. The worker runs ../ado/stan_worker.js,
// which dynamic-imports the compiled model and samples via tinystan.

/**
 * Create a Stan Web Worker client.
 *
 * @returns {{ init: (moduleUrl: string, wasmUrl: ?string) => Promise<Object>,
 *             sample: (req: {data: Object, params: string[], sampleConfig: Object}) => Promise<Object> }}
 */
function createStanWorkerClient() {
  let worker = null;
  // Requests are strictly sequential (init, then one awaited sample per trial),
  // so a single in-flight slot is enough.
  let pending = null;

  function settlePending(settle) {
    if (!pending) {
      return;
    }
    const current = pending;
    pending = null;
    settle(current);
  }

  function ensureWorker() {
    if (worker) {
      return;
    }
    worker = new Worker(new URL("../ado/stan_worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = function (event) {
      const message = event.data;
      settlePending((p) =>
        message.type === "error" ? p.reject(new Error(message.error)) : p.resolve(message),
      );
    };
    // Worker-script-level failures (bad module path / 404 / parse error in the
    // worker or its imports) fire onerror and never post a message, so the pending
    // request would otherwise hang forever. Terminate and drop the dead worker (so
    // its thread/WASM instance isn't leaked), then reject the in-flight request with
    // a clear error; any later send() fails fast rather than null-dereferencing the
    // worker. (#8)
    worker.onerror = function (event) {
      if (worker) {
        worker.terminate();
      }
      worker = null;
      settlePending((p) =>
        p.reject(new Error("Stan worker failed to load: " + (event.message || "worker error"))),
      );
    };
    worker.onmessageerror = function () {
      if (worker) {
        worker.terminate();
      }
      worker = null;
      settlePending((p) => p.reject(new Error("Stan worker message could not be deserialized")));
    };
  }

  function send(message) {
    // Requests are strictly sequential; a concurrent send would clobber the single
    // pending slot and orphan the first promise, so fail loudly instead.
    if (pending) {
      return Promise.reject(
        new Error("Stan controller received a request while one was already in flight"),
      );
    }
    // The worker is created in init() via ensureWorker(); if it died (onerror/
    // onmessageerror nulled it), fail with a clear message instead of dereferencing
    // null. (#8)
    if (!worker) {
      return Promise.reject(new Error("Stan worker is unavailable (it failed to load earlier)."));
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(message);
    });
  }

  return {
    init(moduleUrl, wasmUrl) {
      ensureWorker();
      return send({ type: "init", moduleUrl, wasmUrl });
    },
    sample({ data, params, sampleConfig }) {
      return send({ type: "sample", data, params, sampleConfig });
    },
  };
}

export { createStanWorkerClient };
