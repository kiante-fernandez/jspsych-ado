// experiments/delay_discounting/models/compile_stan_model.js
//
// OPTIONAL convenience. Compile a Stan model from a source STRING at experiment
// setup and return a ready-to-use model adapter — the same shape the committed
// models/<name>/model.js files export:
//
//     { id, params, prior, moduleUrl, buildData, choiceProbLL }
//
// It does NOT touch the engine, the worker (ado/stan_worker.js), or the
// controller (controllers/stan_ado_controller.js). It only produces the adapter
// object; `moduleUrl` points at the compiled main.js that the existing worker
// already dynamic-imports. So the result is a drop-in `model:` for
// createStanAdoController(...).
//
// TRADE-OFF vs the committed-artifact workflow (see models/README.md):
// this skips the curl/commit step, but the compiled module is fetched from the
// compile server at RUN TIME, so every participant load depends on that server
// (and on cross-origin access to it). Fine for prototyping. For a deployed study,
// download main.js + main.wasm once, commit them, and write a normal model.js so
// the live experiment is pure static assets.

const DEFAULT_SERVER = "https://stan-wasm.flatironinstitute.org";
const DEFAULT_TOKEN = "1234";

// In-memory cache: identical source compiled once per page session.
const _moduleUrlCache = new Map(); // stanSource -> moduleUrl

/**
 * Compile a .stan source string and return a model adapter for
 * createStanAdoController. Resolves once the compile server has produced the
 * module; the adapter's choiceProbLL / buildData / prior are supplied by you and
 * must match the .stan likelihood and priors (same rule as a hand-written
 * models/<name>/model.js).
 *
 * @param {Object} opts
 * @param {string}   opts.id            - Model id saved into the data (e.g. "exponential").
 * @param {string}   opts.stan          - Full .stan source as a string.
 * @param {string[]} opts.params        - Parameter names to summarize, e.g. ["r","tau"].
 * @param {Object}   opts.prior         - { param: { dist, ... } }, MUST match the .stan priors.
 * @param {Function} opts.buildData     - (trials) => Stan data block. trials are
 *                                        {t_ss,t_ll,r_ss,r_ll,choice} rows.
 * @param {Function} opts.choiceProbLL  - (design, paramDraw) => P(response = 1 = LL),
 *                                        MUST match the .stan likelihood. Design first.
 * @param {string}  [opts.server]       - Compile server base URL. Default: Flatiron public
 *                                        server. Local server: "http://localhost:8083".
 * @param {string}  [opts.authToken]    - Bearer token for the compile endpoint.
 * @returns {Promise<Object>} Resolves to { id, params, prior, moduleUrl, buildData, choiceProbLL }.
 */
async function compileStanModel({
  id,
  stan,
  params,
  prior,
  buildData,
  choiceProbLL,
  server = DEFAULT_SERVER,
  authToken = DEFAULT_TOKEN,
} = {}) {
  // Validate the adapter pieces up front so a typo fails here, not deep in the worker.
  for (const [key, value] of Object.entries({ id, stan, params, prior, buildData, choiceProbLL })) {
    if (value == null) {
      throw new Error(`compileStanModel: missing required option "${key}".`);
    }
  }

  // Normalize a trailing slash so `${server}/compile` is always well-formed.
  const base = server.replace(/\/+$/, "");

  let moduleUrl = _moduleUrlCache.get(stan);
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
        `and pass server:"http://localhost:8083". Original error: ${String(networkError)}`
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
    _moduleUrlCache.set(stan, moduleUrl);
  }

  // Identical shape to models/<name>/model.js default export.
  return { id, params, prior, moduleUrl, buildData, choiceProbLL };
}

export { compileStanModel };
