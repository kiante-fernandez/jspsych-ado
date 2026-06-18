// jspsych-ado/index.js — the jsPsychADO façade (package entry point).
//
// A thin façade that lets researchers register a model from a Stan SOURCE STRING
// and a few JS callbacks, then build the timeline with a one-line call:
//
//   jsPsychADO.registerModel("my-hyperbolic", { stanCode, params, design_grid,
//                                                linkProb, toStanData, response_labels,
//                                                presentation });
//   await jsPsychADO.prepareModels({ compileServer: "https://compile.yourlab.org" });
//   const dd = jsPsychADO.createTimeline(jsPsych, { model: "my-hyperbolic" });
//   jsPsych.run([ ...dd ]);
//
// It does NOT modify the engine (ado/mi_engine.js), the worker (ado/stan_worker.js),
// the controller (controllers/stan_ado_controller.js), or the generic timeline
// (ado/ado_timeline.js). It only TRANSLATES the researcher-friendly spec into:
//   - a model adapter   { id, params, prior, moduleUrl, buildData, choiceProbLL }
//   - a controller via  createStanAdoController(...)
//   - a timeline via    createAdoTimeline(...)
//
// Three things the façade reconciles, because the friendly spec and the engine
// disagree on shape:
//   1. linkProb(theta, design)  ->  choiceProbLL(design, draw)   (argument order)
//   2. toStanData([{design,response}])  <-  engine passes flat {...design,choice} rows
//   3. The engine needs a JS-side `prior` to pick the first design before any data.
//      The snippet doesn't supply one, so we derive it from the Stan source (or you
//      can pass an explicit `prior`, which always wins).

import { createStanAdoController } from "./controllers/stan_ado_controller.js";
import { createAdoTimeline } from "./ado/ado_timeline.js";

const DEFAULT_STAN = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };
const DEFAULT_N_TRIALS = 42;
const DEFAULT_TOKEN = "1234";

const REGISTRY = new Map();        // name -> entry
const _compileCache = new Map();   // stanCode -> moduleUrl (per page session)

// ---------------------------------------------------------------------------
// registerModel
// ---------------------------------------------------------------------------

/**
 * Register a model. Provide exactly one source: a Stan source string (`stanCode`),
 * a URL to a .stan file (`stanUrl`), or a precompiled module URL (`moduleUrl`).
 *
 * @param {string} name
 * @param {Object} spec
 * @param {string}   [spec.stanCode]      - Full .stan source as a string.
 * @param {string}   [spec.stanUrl]       - URL to a .stan file (fetched in prepareModels).
 * @param {string}   [spec.moduleUrl]     - Precompiled main.js URL (skips compilation).
 * @param {Array}    spec.params          - ["log_k","tau"] or [{name,scale,role,lower}, ...].
 * @param {Object}   [spec.prior]         - Optional explicit JS prior; overrides Stan-derived.
 * @param {Object}   spec.design_grid     - Candidate grid {t_ss,t_ll,r_ss,r_ll} arrays.
 * @param {Function} spec.linkProb        - (theta, design) => P(LL).
 * @param {Function} [spec.toStanData]    - (trials:[{design,response}]) => Stan data block.
 *                                          The friendly shape for inline/source models.
 * @param {Function} [spec.buildData]     - (trials:[{...design,choice}]) => Stan data block.
 *                                          A model package's native builder; used as-is
 *                                          (no reshape). Provide this OR toStanData.
 * @param {Object}   spec.presentation    - Stimulus spec for the generic timeline:
 *                                          getChoiceTrials(ctx) OR makeStimulus(design)
 *                                          (+ optional button_html/keymap/prompt/describeDesign).
 * @param {string[]} [spec.choices]       - Button/key labels in index order (e.g. ["SS","LL"]).
 * @param {Function} [spec.responseToOutcome] - (design, choiceIndex) => 0|1. Default identity.
 * @param {Object}   [spec.posterior_display] - Per-parameter chart labels/ranges for debug.
 * @param {string[]|Object} spec.response_labels - ["SS","LL"] or {0:"SS",1:"LL"}.
 * @param {string}   [spec.task]          - Task label saved into each data row.
 * @param {Object}   [spec.stan]          - Default sampler settings for this model.
 * @param {number}   [spec.n_trials]      - Default trial count for this model.
 */
function registerModel(name, spec) {
  if (!name || typeof name !== "string") {
    throw new Error("registerModel: a string name is required.");
  }
  const sources = ["stanCode", "stanUrl", "moduleUrl"].filter((k) => spec[k] != null);
  if (sources.length !== 1) {
    throw new Error(
      `registerModel("${name}"): provide exactly one of stanCode | stanUrl | moduleUrl (got ${sources.length}).`
    );
  }
  for (const k of ["params", "design_grid", "linkProb", "response_labels", "presentation"]) {
    if (spec[k] == null) throw new Error(`registerModel("${name}"): missing required field "${k}".`);
  }
  if (spec.toStanData == null && spec.buildData == null) {
    throw new Error(
      `registerModel("${name}"): provide toStanData([{design,response}]) or buildData([{...design,choice}]).`
    );
  }
  if (typeof spec.presentation.getChoiceTrials !== "function" && typeof spec.presentation.makeStimulus !== "function") {
    throw new Error(
      `registerModel("${name}"): presentation must provide getChoiceTrials(ctx) or makeStimulus(design).`
    );
  }
  if (REGISTRY.has(name)) {
    console.warn(`registerModel: overwriting already-registered model "${name}".`);
  }

  const paramNames = spec.params.map((p) => (typeof p === "string" ? p : p.name));

  // The engine samples the prior (JS-side) to choose the first design. Prefer an
  // explicit prior; otherwise derive it from the Stan source. stanUrl entries
  // defer derivation until prepareModels() has fetched the source.
  const prior = spec.prior ?? (spec.stanCode ? parseStanPriors(spec.stanCode, spec.params) : null);
  if (!prior && spec.moduleUrl) {
    throw new Error(
      `registerModel("${name}"): no prior available. Pass an explicit \`prior\` when ` +
      `registering with \`moduleUrl\`, because no Stan source is available to parse.`
    );
  }

  REGISTRY.set(name, {
    name,
    spec,
    paramNames,
    prior,
    moduleUrl: spec.moduleUrl ?? null, // filled by prepareModels when compiling from source
  });
}

// ---------------------------------------------------------------------------
// prepareModels
// ---------------------------------------------------------------------------

/**
 * Compile any registered models that came from a Stan source. Run once at study
 * setup (not per participant). Models registered with a precompiled `moduleUrl`
 * are skipped. Compiled module URLs are cached by source within the page session.
 *
 * @param {Object} opts
 * @param {string} opts.compileServer - Base URL of a Stan-to-WASM compile server
 *   (e.g. "https://stan-wasm.flatironinstitute.org" or "http://localhost:8083").
 * @param {string} [opts.authToken]   - Bearer token for the compile endpoint.
 */
async function prepareModels({ compileServer, authToken = DEFAULT_TOKEN } = {}) {
  for (const entry of REGISTRY.values()) {
    if (entry.moduleUrl) continue; // precompiled or already prepared

    const { spec } = entry;
    if (!compileServer) {
      throw new Error(
        `prepareModels: model "${entry.name}" needs compilation, but no compileServer was provided.`
      );
    }

    let stanCode = spec.stanCode;
    if (!stanCode && spec.stanUrl) {
      const res = await fetch(spec.stanUrl);
      if (!res.ok) {
        throw new Error(`prepareModels: could not fetch stanUrl for "${entry.name}" (${res.status}).`);
      }
      stanCode = await res.text();
    }

    if (!entry.prior) {
      entry.prior = parseStanPriors(stanCode, spec.params);
    }

    let moduleUrl = _compileCache.get(stanCode);
    if (!moduleUrl) {
      moduleUrl = await compileToModuleUrl(stanCode, compileServer, authToken);
      _compileCache.set(stanCode, moduleUrl);
    }
    entry.moduleUrl = moduleUrl;
  }
}

// ---------------------------------------------------------------------------
// createTimeline
// ---------------------------------------------------------------------------

/**
 * Build the adaptive timeline fragment for a registered model (any task).
 *
 * @param {Object} jsPsych
 * @param {Object} config
 * @param {string} config.model        - A registered model name.
 * @param {string} [config.task]       - Task label saved into each data row.
 * @param {Object} [config.stan]       - Sampler overrides {num_chains,num_warmup,num_samples,seed}.
 * @param {number} [config.n_trials]   - Trial count override.
 * @param {string} [config.session_id] - Session id saved into the data.
 * @param {string} [config.design_strategy="ado"] - "ado" for MI-selected
 *   designs, "random" for a recovery/dev baseline sampled from the same grid.
 * @param {?number} [config.design_seed] - Optional seed for prior/random design selection.
 * @param {Object} [run_context]       - Passed through to the timeline (e.g. {debug:true}).
 * @returns {Array} jsPsych timeline fragment (spreadable into jsPsych.run).
 */
function createTimeline(jsPsych, config = {}, run_context = {}) {
  const entry = REGISTRY.get(config.model);
  if (!entry) {
    const known = [...REGISTRY.keys()].map((n) => `"${n}"`).join(", ") || "none";
    throw new Error(`createTimeline: unknown model "${config.model}". Registered: ${known}.`);
  }
  if (!entry.moduleUrl) {
    throw new Error(
      `createTimeline: model "${config.model}" isn't compiled yet. ` +
      `Call \`await jsPsychADO.prepareModels({ compileServer })\` first, ` +
      `or register it with a precompiled \`moduleUrl\`.`
    );
  }
  if (config.testlet_size != null && config.testlet_size !== 1) {
    console.warn(
      `createTimeline: testlet_size is not supported by the current engine, which refits Stan ` +
      `after every choice. Ignoring testlet_size=${config.testlet_size}.`
    );
  }

  const adapter = buildAdapter(entry);
  const spec = entry.spec;
  const grid_design = spec.design_grid;
  const stan = { ...DEFAULT_STAN, ...spec.stan, ...config.stan };
  const n_trials = config.n_trials ?? spec.n_trials ?? DEFAULT_N_TRIALS;
  const response_labels = labelsToConfig(spec.response_labels);

  const controller = createStanAdoController({
    model: adapter,
    grid_design,
    stan,
    n_trials,
    session_id: config.session_id,
    design_strategy: config.design_strategy ?? "ado",
    design_seed: config.design_seed ?? null,
  });

  // The generic timeline reads the model's presentation, choices, and (optional)
  // responseToOutcome; everything stimulus-specific lives in the model package.
  const timeline_config = {
    n_trials,
    response_labels,
    presentation: spec.presentation,
    choices: spec.choices,
    responseToOutcome: spec.responseToOutcome,
    task: config.task ?? spec.task ?? adapter.id,
  };

  return createAdoTimeline(jsPsych, controller, timeline_config, {
    ado_mode: "stan",
    controller_mode: "stan",
    design_strategy: config.design_strategy ?? "ado",
    model_id: adapter.id,
    posterior_display: spec.posterior_display,
    ...run_context,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Turn a registry entry into the engine's model adapter shape, bridging the
// argument-order / trial-shape mismatches between the friendly spec and the engine.
function buildAdapter(entry) {
  const { spec, name, paramNames, prior, moduleUrl } = entry;
  const { linkProb, toStanData, buildData } = spec;

  // The engine pushes flat rows {...design, choice} (any design keys). A model
  // package's native buildData already reads that shape, so use it as-is. The
  // friendly toStanData path instead wants {design, response}, so reshape into it.
  const adaptedBuildData = buildData
    ? buildData
    : (trials) => toStanData(trials.map(({ choice, ...design }) => ({ design, response: choice })));

  return {
    id: name,
    params: paramNames,
    prior,
    moduleUrl,
    buildData: adaptedBuildData,
    // Engine calls choiceProbLL(design, draw); the researcher wrote linkProb(theta, design).
    choiceProbLL: (design, draw) => linkProb(draw, design),
  };
}

// Convert ["SS","LL"] -> {0:"SS",1:"LL"}; pass an object through unchanged.
function labelsToConfig(labels) {
  if (Array.isArray(labels)) {
    return Object.fromEntries(labels.map((label, index) => [index, label]));
  }
  return labels;
}

// POST a Stan source string to the compile server and return the main.js URL.
// main.js loads its sibling main.wasm relative to its own URL, so pointing the
// adapter's moduleUrl at the server's main.js needs no committing and no worker
// changes. Mirrors models/compile_stan_model.js. Assumes /compile returns
// {model_id} synchronously (as the documented curl does).
async function compileToModuleUrl(stanCode, server, authToken) {
  const base = server.replace(/\/+$/, "");

  let res;
  try {
    res = await fetch(`${base}/compile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${authToken}` },
      body: stanCode,
    });
  } catch (networkError) {
    throw new Error(
      `prepareModels: could not reach the compile server at ${base}. Check the URL/CORS, ` +
      `or run one locally (docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest) ` +
      `and pass compileServer:"http://localhost:8083". Original error: ${String(networkError)}`
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`prepareModels: compile failed (${res.status}). ${detail}`.trim());
  }
  const payload = await res.json().catch(() => null);
  const model_id = payload && payload.model_id;
  if (!model_id) {
    throw new Error("prepareModels: server response did not include a model_id.");
  }
  return `${base}/download/${model_id}/main.js`;
}

// Derive the engine's JS prior {param:{dist,...}} from the Stan source. Deliberately
// limited: it reads `param ~ dist(args);` sampling statements and supports normal,
// lognormal, and (for <lower=0> params) normal-as-half-normal. Anything else throws
// with a clear message asking for an explicit `prior`. This keeps the friendly path
// working without ever silently inventing a wrong prior.
function parseStanPriors(stanCode, paramSpecs) {
  const prior = {};

  for (const p of paramSpecs) {
    const name = typeof p === "string" ? p : p.name;
    const meta = typeof p === "string" ? {} : p;

    const declaredPositive =
      meta.lower === 0 ||
      new RegExp(`real\\s*<[^>]*lower\\s*=\\s*0[^>]*>\\s*${name}\\b`).test(stanCode);

    const match = new RegExp(`\\b${name}\\s*~\\s*(\\w+)\\s*\\(([^;]*)\\)\\s*;`).exec(stanCode);
    if (!match) {
      throw new Error(
        `registerModel: no prior found for "${name}" in the Stan source. Add a sampling ` +
        `statement (e.g. ${name} ~ normal(...);) or pass an explicit \`prior\`.`
      );
    }
    const dist = match[1];
    const args = match[2].split(",").map((s) => Number(s.trim()));
    if (args.some(Number.isNaN)) {
      throw new Error(
        `registerModel: could not read numeric prior arguments for "${name}" ("${match[2].trim()}"). ` +
        `Pass an explicit \`prior\`.`
      );
    }

    if (dist === "lognormal") {
      prior[name] = { dist: "lognormal", meanlog: args[0], sdlog: args[1] };
    } else if (dist === "normal") {
      if (declaredPositive) {
        if (Math.abs(args[0]) > 1e-9) {
          throw new Error(
            `registerModel: "${name}" is lower-bounded at 0 with a non-zero-mean normal prior ` +
            `(a truncated normal), which the prior sampler can't represent. Pass an explicit ` +
            `\`prior\` (e.g. { dist:"halfnormal", sd:... }).`
          );
        }
        prior[name] = { dist: "halfnormal", sd: args[1] };
      } else {
        prior[name] = { dist: "normal", mean: args[0], sd: args[1] };
      }
    } else {
      throw new Error(
        `registerModel: unsupported Stan prior "${dist}(...)" for "${name}". Auto-parse supports ` +
        `normal, lognormal, and normal+<lower=0> (half-normal). Pass an explicit \`prior\` for others.`
      );
    }
  }

  return prior;
}

const jsPsychADO = { registerModel, prepareModels, createTimeline };

export { jsPsychADO, registerModel, prepareModels, createTimeline, parseStanPriors, labelsToConfig, buildAdapter };
export default jsPsychADO;
