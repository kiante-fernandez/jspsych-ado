// src/models/compile_stan_model.js
//
// OPTIONAL convenience. Compile a Stan model from a source STRING at experiment
// setup and return a ready-to-use model adapter — the same shape the committed
// src/models/<name>/model.js files export:
//
//     { id, params, designKeys, responseSpace, prior, moduleUrl, buildData, responseProb/responseProbs }
//
// It does NOT touch the engine, the worker (src/ado/stan_worker.js), or the
// controller (src/controllers/stan_ado_controller.js). It only produces the adapter
// object; `moduleUrl` points at the compiled main.js that the existing worker
// already dynamic-imports. So the result is a drop-in `model:` for
// createStanAdoController(...).
//
// TRADE-OFF vs the committed-artifact workflow (see src/models/README.md):
// this skips the curl/commit step, but the compiled module is fetched from the
// compile server at RUN TIME, so every participant load depends on that server
// (and on cross-origin access to it). Fine for prototyping. For a deployed study,
// download main.js + main.wasm once, commit them, and write a normal model.js so
// the live experiment is pure static assets.

const DEFAULT_SERVER = "https://stan-wasm.flatironinstitute.org";
const DEFAULT_TOKEN = "1234";

// In-memory cache keyed by server+source: identical source compiled once per
// (server, page session). Keying on source alone would return one server's stale
// download URL when the same .stan is later compiled against a different server.
const _moduleUrlCache = new Map(); // `${server}\n${stanSource}` -> moduleUrl

/**
 * Compile a .stan source string and return a model adapter for
 * createStanAdoController. Resolves once the compile server has produced the
 * module; the adapter's responseProb or responseProbs / buildData / prior are
 * supplied by you and must match the .stan likelihood and priors (same rule as a hand-written
 * src/models/<name>/model.js).
 *
 * @param {Object} opts
 * @param {string}   opts.id            - Model id saved into the data (e.g. "exponential").
 * @param {string}   opts.stan          - Full .stan source as a string.
 * @param {string[]} opts.params        - Parameter names to summarize, e.g. ["r","tau"].
 * @param {string[]} opts.designKeys    - Design fields consumed by the model.
 * @param {Object}   opts.responseSpace - {type:"binary"} or {type:"categorical", n_categories}.
 * @param {Object}   opts.prior         - { param: { dist, ... } }, MUST match the .stan priors.
 * @param {Function} opts.buildData     - (trials) => Stan data block. trials are
 *                                        flat {...design, choice} rows.
 * @param {Function} opts.responseProb  - (design, paramDraw) => P(outcome = 1),
 *                                        MUST match the .stan likelihood. Design first.
 * @param {Function} opts.responseProbs - (design, paramDraw) => [p0, p1, ...],
 *                                        required for categorical models.
 * @param {string}  [opts.server]       - Compile server base URL. Default: Flatiron public
 *                                        server. Local server: "http://localhost:8083".
 * @param {string}  [opts.authToken]    - Bearer token for the compile endpoint.
 * @returns {Promise<Object>} Resolves to the committed model-package shape.
 */
async function compileStanModel({
  id,
  stan,
  params,
  designKeys,
  responseSpace,
  prior,
  buildData,
  responseProb,
  responseProbs,
  server = DEFAULT_SERVER,
  authToken = DEFAULT_TOKEN,
} = {}) {
  // Validate the adapter pieces up front so a typo fails here, not deep in the worker.
  for (const [key, value] of Object.entries({
    id,
    stan,
    params,
    designKeys,
    responseSpace,
    prior,
    buildData,
  })) {
    if (value == null) {
      throw new Error(`compileStanModel: missing required option "${key}".`);
    }
  }
  if (typeof responseProb !== "function" && typeof responseProbs !== "function") {
    throw new Error("compileStanModel: provide responseProb or responseProbs.");
  }
  // Validate responseSpace up front so a typo fails here, not deep in the engine. (#12)
  if (responseSpace.type !== "binary" && responseSpace.type !== "categorical") {
    throw new Error(
      `compileStanModel: unsupported responseSpace.type "${responseSpace.type}" (expected "binary" or "categorical").`,
    );
  }
  if (
    responseSpace.type === "categorical" &&
    !(Number.isInteger(responseSpace.n_categories) && responseSpace.n_categories >= 2)
  ) {
    throw new Error(
      "compileStanModel: categorical responseSpace needs an integer n_categories >= 2.",
    );
  }
  if (responseSpace.type === "categorical" && typeof responseProbs !== "function") {
    throw new Error("compileStanModel: categorical models must provide responseProbs.");
  }

  // Normalize a trailing slash so `${server}/compile` is always well-formed.
  const base = server.replace(/\/+$/, "");

  const cacheKey = `${base}\n${stan}`;
  let moduleUrl = _moduleUrlCache.get(cacheKey);
  if (!moduleUrl) {
    let response;
    try {
      response = await fetch(`${base}/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${authToken}`,
        },
        body: stan,
      });
    } catch (networkError) {
      throw new Error(
        `compileStanModel: could not reach the compile server at ${base}. ` +
          `Check the URL/CORS, or run a local server ` +
          `(docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest) ` +
          `and pass server:"http://localhost:8083". Original error: ${String(networkError)}`,
      );
    }

    if (!response.ok) {
      // Stan syntax errors and server failures surface here with the compiler message.
      const detail = await response.text().catch(() => "");
      throw new Error(`compileStanModel: compile failed (${response.status}). ${detail}`.trim());
    }

    const payload = await response.json().catch(() => null);
    const model_id = payload && payload.model_id;
    if (!model_id) {
      throw new Error("compileStanModel: server response did not include a model_id.");
    }

    // main.js hardcodes loading its sibling main.wasm, and emscripten resolves the
    // wasm relative to the module URL. Pointing moduleUrl at the server's main.js
    // download path therefore makes main.wasm load from the adjacent server path —
    // no committing and no worker/engine changes needed.
    moduleUrl = `${base}/download/${model_id}/main.js`;
    _moduleUrlCache.set(cacheKey, moduleUrl);
  }

  // Identical shape to models/<name>/model.js default export.
  return {
    id,
    params,
    designKeys,
    responseSpace,
    prior,
    moduleUrl,
    buildData,
    responseProb,
    responseProbs,
  };
}

export { compileStanModel };
