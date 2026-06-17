// Generic Stan sampling Web Worker (one file for any model).
//
// Runs NUTS off the main thread so the page never freezes between trials. The
// controller posts {type:"init", moduleUrl} once, then {type:"sample", data,
// params, sampleConfig} per trial; the worker replies with only the requested
// parameter columns to keep transfers small. Pattern follows stan-playground's
// StanModelWorker.ts.

import StanModel from "../../../core/tinystan/index.mjs";

let modelPromise = null;

// The controller issues one request at a time and matches replies by type, so no
// message ids are needed.
self.onmessage = async function(event) {
  const message = event.data;

  try {
    if (message.type === "init") {
      // Dynamic-import the committed emscripten module by absolute URL, then hand
      // its default export (createModule) to tinystan. Load is memoized. The no-op
      // print callback swallows Stan's per-iteration stdout so the console stays
      // clean across the per-trial sampling calls.
      modelPromise = import(/* @vite-ignore */ message.moduleUrl).then(module =>
        StanModel.load(module.default, () => {})
      );
      await modelPromise;
      self.postMessage({ type: "ready" });
      return;
    }

    if (message.type === "sample") {
      if (!modelPromise) {
        throw new Error("Worker received sample before init");
      }
      const model = await modelPromise;
      const fit = model.sample({ data: message.data, ...message.sampleConfig });

      // Return only the requested parameter columns (e.g. k, tau), not the full
      // sampler/transformed/generated-quantities output.
      const draws = {};
      for (const param of message.params) {
        const index = fit.paramNames.indexOf(param);
        if (index < 0) {
          throw new Error(`Parameter "${param}" not found in Stan output`);
        }
        draws[param] = fit.draws[index];
      }
      self.postMessage({ type: "result", draws });
      return;
    }

    throw new Error(`Unknown worker message type: ${message.type}`);
  } catch (error) {
    self.postMessage({ type: "error", error: String((error && error.message) || error) });
  }
};
