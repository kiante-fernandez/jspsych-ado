// src/index.js — the jsPsychADO façade (package entry point).
//
// Researchers register two composable pieces:
//   - a task:  design grid, presentation, choices, and response labels
//   - a model: parameters, priors, likelihood, Stan data builder, and WASM module
//
// Then createTimeline validates the task/model pair and builds the standard ADO
// timeline around the in-browser Stan controller. The task/model validators live in
// ado/validation.js and the Stan-source helpers (prior parsing + remote compile) in
// models/stan_source.js; this file owns the registries and the public surface.

import { createStanAdoController } from "./controllers/stan_ado_controller.js";
import { createAdoTimeline } from "./ado/ado_timeline.js";
import { arange, linspace } from "./ado/grid.js";
import { makeStanDataBuilder, validateStanDataSpec } from "./ado/stan_data.js";
import {
  validateTask,
  validateModel,
  validateTaskModelPair,
  validateResponseSpace,
  isContinuous,
  continuousModelProblems,
} from "./ado/validation.js";
import { parseStanPriors, compileToModuleUrl } from "./models/stan_source.js";

const DEFAULT_STAN = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };
const DEFAULT_N_TRIALS = 42;
const DEFAULT_TOKEN = "1234";

const MODEL_REGISTRY = new Map();  // name -> entry
const TASK_REGISTRY = new Map();   // name -> task spec
const _compileCache = new Map();   // `${server}\n${stanCode}` -> moduleUrl (per page session)

// ---------------------------------------------------------------------------
// registerTask
// ---------------------------------------------------------------------------

/**
 * Register a task. A task owns presentation and response coding; models only
 * own the statistical likelihood and Stan data boundary.
 *
 * @param {string} name
 * @param {Object} spec
 * @param {Object|Array<Object>} spec.design_grid - Candidate designs.
 * @param {string[]} spec.designKeys - Design keys the task provides.
 * @param {Object} spec.responseSpace - {type:"binary"}, {type:"categorical", n_categories}, or {type:"continuous"}.
 * @param {Object} spec.presentation - getChoiceTrials(ctx) OR makeStimulus(design).
 * @param {string[]} [spec.choices] - Button/key labels in index order.
 * @param {string[]|Object} spec.response_labels - ["SS","LL"] or {0:"SS",1:"LL"}.
 * @param {Function} [spec.responseToOutcome] - (design, rawResponse) => outcome.
 *   Discrete: maps a choice index to an outcome index (default identity). Continuous:
 *   defaults to identity, passing the raw real-valued response through as the outcome.
 */
function registerTask(name, spec) {
  if (!name || typeof name !== "string") {
    throw new Error("registerTask: a string name is required.");
  }
  const task_spec = { ...(spec || {}), id: spec && spec.id ? spec.id : name };
  const { valid, problems } = validateTask(task_spec);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    throw new Error(
      `registerTask("${name}"): invalid task:\n  - ` +
      errors.map((e) => e.message).join("\n  - ")
    );
  }
  for (const w of problems.filter((p) => p.level === "warn")) {
    console.warn(`registerTask("${name}"): ${w.message}`);
  }
  if (!valid) {
    throw new Error(`registerTask("${name}"): invalid task.`);
  }
  if (TASK_REGISTRY.has(name)) {
    console.warn(`registerTask: overwriting already-registered task "${name}".`);
  }
  TASK_REGISTRY.set(name, task_spec);
}

// ---------------------------------------------------------------------------
// registerModel
// ---------------------------------------------------------------------------

/**
 * Register a statistical model. Provide exactly one source: a Stan source string
 * (`stanCode`), a URL to a .stan file (`stanUrl`), or a precompiled module URL
 * (`moduleUrl`).
 *
 * @param {string} name
 * @param {Object} spec
 * @param {string}   [spec.stanCode]      - Full .stan source as a string.
 * @param {string}   [spec.stanUrl]       - URL to a .stan file.
 * @param {string}   [spec.moduleUrl]     - Precompiled main.js URL.
 * @param {Array}    spec.params          - ["k","tau"] or [{name,lower}, ...].
 * @param {Object}   [spec.prior]         - Optional explicit JS prior.
 * @param {string[]} spec.designKeys      - Design fields consumed by the model.
 * @param {Object}   spec.responseSpace   - {type:"binary"}, {type:"categorical", n_categories}, or {type:"continuous"}.
 * @param {Function} [spec.responseProb]  - Binary likelihood: (design, draw) => P(outcome = 1).
 * @param {Function} [spec.responseProbs] - Categorical likelihood: (design, draw) => [p0, p1, ...].
 * @param {Function} [spec.responseDensity] - Continuous likelihood: (design, draw, y) => p(y | theta, d) >= 0.
 * @param {Function} [spec.responseMoments] - Continuous: (design, draw) => {mean, sd}; auto-derives the integration support.
 * @param {Array|Function} [spec.responseSupport] - Continuous: [lo, hi] or (design, draws) => [lo, hi] (alternative to responseMoments).
 * @param {Function} [spec.conditionalEntropy] - Continuous: (design, draw) => H(y | theta, d), closed form (optional).
 * @param {Function} [spec.responseDensityFactory] - Continuous: (design, draw) => ((y) => density), hot-loop fast path (optional).
 * @param {Function} [spec.responseSampler] - Continuous: (design, params, rng) => y, used by the simulator (optional).
 * @param {Function} [spec.toStanData]    - (trials:[{design,response}]) => Stan data.
 * @param {Function} [spec.buildData]     - (trials:[{...design,choice}]) => Stan data.
 * @param {Object}   [spec.posterior_display] - Per-parameter chart labels/ranges.
 * @param {Object}   [spec.stan]          - Default sampler settings.
 * @param {number}   [spec.n_trials]      - Default trial count.
 * @param {number}   [spec.testlet_size]  - Default choice trials between refits.
 */
function registerModel(name, spec) {
  if (!name || typeof name !== "string") {
    throw new Error("registerModel: a string name is required.");
  }
  if (!spec || typeof spec !== "object") {
    throw new Error(`registerModel("${name}"): spec must be an object.`);
  }
  for (const k of ["design_grid", "presentation", "choices", "response_labels", "responseToOutcome", "task"]) {
    if (spec[k] != null) {
      throw new Error(`registerModel("${name}"): ${k} belongs on a task; register it with registerTask(...).`);
    }
  }
  if (spec.linkProb != null) {
    throw new Error(`registerModel("${name}"): linkProb has been renamed to responseProb.`);
  }
  const sources = ["stanCode", "stanUrl", "moduleUrl"].filter((k) => spec[k] != null);
  if (sources.length !== 1) {
    throw new Error(
      `registerModel("${name}"): provide exactly one of stanCode | stanUrl | moduleUrl (got ${sources.length}).`
    );
  }
  for (const k of ["params", "designKeys", "responseSpace"]) {
    if (spec[k] == null) throw new Error(`registerModel("${name}"): missing required field "${k}".`);
  }
  if (spec.stanData == null && spec.toStanData == null && spec.buildData == null) {
    throw new Error(
      `registerModel("${name}"): provide a stanData map, or buildData([{...design,choice}]), or toStanData([{design,response}]).`
    );
  }
  if (spec.stanData != null) {
    const stan_data_problems = validateStanDataSpec(spec.stanData);
    if (stan_data_problems.length) {
      throw new Error(`registerModel("${name}"): invalid stanData:\n  - ` + stan_data_problems.join("\n  - "));
    }
  }
  if (!Array.isArray(spec.params) || spec.params.length === 0) {
    throw new Error(`registerModel("${name}"): params must be a non-empty array.`);
  }
  if (!spec.params.every((p) => typeof p === "string" || (p && typeof p.name === "string"))) {
    throw new Error(`registerModel("${name}"): params entries must be strings or objects with a name.`);
  }
  if (!Array.isArray(spec.designKeys) || spec.designKeys.length === 0) {
    throw new Error(`registerModel("${name}"): designKeys must be a non-empty array.`);
  }
  const response_space_error = validateResponseSpace(spec.responseSpace, `registerModel("${name}")`);
  if (response_space_error) {
    throw new Error(response_space_error);
  }
  if (isContinuous(spec.responseSpace)) {
    const cont_problems = continuousModelProblems(spec);
    if (cont_problems.length) {
      throw new Error(`registerModel("${name}"): ${cont_problems[0]}`);
    }
  } else {
    if (spec.responseSpace.type === "categorical" && typeof spec.responseProbs !== "function") {
      throw new Error(`registerModel("${name}"): categorical models must provide responseProbs(design, draw).`);
    }
    if (typeof spec.responseProb !== "function" && typeof spec.responseProbs !== "function") {
      throw new Error(`registerModel("${name}"): provide responseProb(design, draw) or responseProbs(design, draw).`);
    }
  }
  if (MODEL_REGISTRY.has(name)) {
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
  if (prior) {
    requirePriorCoverage(prior, paramNames, `registerModel("${name}")`);
  }

  MODEL_REGISTRY.set(name, {
    name,
    spec,
    paramNames,
    prior,
    moduleUrl: spec.moduleUrl ?? null, // filled by prepareModels when compiling from source
    // Bundler-emitted .wasm URL (#57). Present for committed model packages; null
    // for source-compiled models, whose remote main.js fetches its own sibling wasm.
    wasmUrl: spec.wasmUrl ?? null,
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
 * @param {string} opts.compileServer - Base URL of a Stan-to-WASM compile server.
 * @param {string} [opts.authToken]   - Bearer token for the compile endpoint.
 */
async function prepareModels({ compileServer, authToken = DEFAULT_TOKEN } = {}) {
  for (const entry of MODEL_REGISTRY.values()) {
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
    requirePriorCoverage(entry.prior, entry.paramNames, `prepareModels("${entry.name}")`);

    // Key the cache by server AND source so the same .stan compiled against a
    // different server doesn't return the first server's stale module URL. (#10)
    const cacheKey = `${(compileServer || "").replace(/\/+$/, "")}\n${stanCode}`;
    let moduleUrl = _compileCache.get(cacheKey);
    if (!moduleUrl) {
      moduleUrl = await compileToModuleUrl(stanCode, compileServer, authToken);
      _compileCache.set(cacheKey, moduleUrl);
    }
    entry.moduleUrl = moduleUrl;
  }
}

// ---------------------------------------------------------------------------
// createTimeline
// ---------------------------------------------------------------------------

/**
 * Build the adaptive timeline fragment for a registered task/model pair.
 *
 * @param {Object} jsPsych
 * @param {Object} config
 * @param {string} config.task        - A registered task name.
 * @param {string} config.model       - A registered model name.
 * @param {Object} [config.stan]      - Sampler overrides.
 * @param {number} [config.n_trials]  - Trial count override.
 * @param {number} [config.testlet_size] - Choice trials shown between Stan refits.
 * @param {string} [config.session_id] - Session id saved into the data.
 * @param {string} [config.design_strategy="ado"] - "ado" or "random".
 * @param {?number} [config.design_seed] - Optional design-selection seed.
 * @param {Object} [run_context]      - Passed through to the timeline.
 * @returns {Array} jsPsych timeline fragment.
 */
function createTimeline(jsPsych, config = {}, run_context = {}) {
  const task = TASK_REGISTRY.get(config.task);
  if (!task) {
    const known = [...TASK_REGISTRY.keys()].map((n) => `"${n}"`).join(", ") || "none";
    throw new Error(`createTimeline: unknown task "${config.task}". Registered: ${known}.`);
  }

  const entry = MODEL_REGISTRY.get(config.model);
  if (!entry) {
    const known = [...MODEL_REGISTRY.keys()].map((n) => `"${n}"`).join(", ") || "none";
    throw new Error(`createTimeline: unknown model "${config.model}". Registered: ${known}.`);
  }
  if (!entry.moduleUrl) {
    throw new Error(
      `createTimeline: model "${config.model}" isn't compiled yet. ` +
      `Call \`await jsPsychADO.prepareModels({ compileServer })\` first, ` +
      `or register it with a precompiled \`moduleUrl\`.`
    );
  }

  const adapter = buildAdapter(entry);
  validateTaskModelPair(task, adapter, config.task, config.model);

  const spec = entry.spec;
  const grid_design = task.design_grid;
  const stan = { ...DEFAULT_STAN, ...spec.stan, ...config.stan };
  const n_trials = config.n_trials ?? spec.n_trials ?? DEFAULT_N_TRIALS;
  const testlet_size = normalizeTestletSize(config.testlet_size ?? spec.testlet_size);
  const response_labels = labelsToConfig(task.response_labels);
  // Adaptive-stopping config (#21): EIG-fraction early stopping + min/max bounds.
  // Omitted => fixed-length run of n_trials (max_trials defaults to n_trials).
  const stopping = config.stopping ?? spec.stopping ?? null;

  const controller = createStanAdoController({
    model: adapter,
    grid_design,
    stan,
    n_trials,
    testlet_size,
    stopping,
    session_id: config.session_id,
    design_strategy: config.design_strategy ?? "ado",
    design_seed: config.design_seed ?? null,
  });

  const timeline_config = {
    n_trials,
    testlet_size,
    stopping,
    response_labels,
    presentation: task.presentation,
    choices: task.choices,
    responseToOutcome: task.responseToOutcome,
    task: task.id ?? config.task,
    // Injected jsPsych plugin classes for bundler consumers (falls back to UMD
    // globals when omitted). See response_trials.js PLUGIN_GLOBALS. (#57)
    plugins: config.plugins,
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

function normalizeTestletSize(value) {
  if (value == null) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`createTimeline: testlet_size must be a positive integer, got ${value}`);
  }
  return value;
}

// Turn a registry entry into the engine's model adapter shape, bridging the
// trial-shape mismatch between inline source models and the engine.
function buildAdapter(entry) {
  const { spec, name, paramNames, prior, moduleUrl, wasmUrl } = entry;
  const { responseProb, responseProbs, toStanData, buildData, stanData } = spec;

  // The engine pushes flat rows {...design, choice} (any design keys). Resolve the
  // Stan data builder by precedence: an explicit buildData wins; else the friendly
  // toStanData path (which wants {design, response}); else generate one from the
  // declarative stanData map (the common case — no hand-written reshape).
  const adaptedBuildData = buildData
    ? buildData
    : toStanData
    ? (trials) => toStanData(trials.map(({ choice, ...design }) => ({ design, response: choice })))
    : makeStanDataBuilder({ stanData, responseSpace: spec.responseSpace });

  return {
    id: name,
    params: paramNames,
    prior,
    moduleUrl,
    wasmUrl, // forwarded to the worker's locateFile so the wasm resolves under a bundler (#57)
    designKeys: spec.designKeys,
    responseSpace: spec.responseSpace,
    buildData: adaptedBuildData,
    responseProb,
    responseProbs: responseProbs || (typeof responseProb === "function"
      ? (design, draw) => {
          const p = responseProb(design, draw);
          return [1 - p, p];
        }
      : null),
    // Continuous-response adapter fields (undefined for discrete models). The
    // engine's createDesignScorer reads these when responseSpace.type === "continuous".
    responseDensity: spec.responseDensity,
    responseDensityFactory: spec.responseDensityFactory,
    conditionalEntropy: spec.conditionalEntropy,
    responseMoments: spec.responseMoments,
    responseSupport: spec.responseSupport,
    responseSampler: spec.responseSampler,
  };
}

// Convert ["SS","LL"] -> {0:"SS",1:"LL"}; pass an object through unchanged.
function labelsToConfig(labels) {
  if (Array.isArray(labels)) {
    return Object.fromEntries(labels.map((label, index) => [index, label]));
  }
  return labels;
}

function requirePriorCoverage(prior, paramNames, context) {
  if (!prior || typeof prior !== "object") {
    throw new Error(`${context}: prior must be an object mapping each parameter to a {dist, ...} spec.`);
  }
  for (const param of paramNames) {
    if (!prior[param] || typeof prior[param] !== "object") {
      throw new Error(`${context}: prior for "${param}" is missing.`);
    }
  }
}

// ---------------------------------------------------------------------------
// registerModelPackage (one-call registration for committed packages)
// ---------------------------------------------------------------------------

/**
 * Register a committed model package in one call.
 *
 * @param {Object} model - The model package default export.
 * @param {Object} [overrides]
 * @param {string} [overrides.name]      - Registry name; defaults to model.id.
 * @param {Object} [overrides.stan]      - Sampler settings; falls back to model.stan.
 * @param {number} [overrides.n_trials]  - Trial count; falls back to model.n_trials.
 * @param {number} [overrides.testlet_size] - Testlet size; falls back to model.testlet_size.
 * @returns {string} The registered model name.
 */
function registerModelPackage(model, overrides = {}) {
  const name = overrides.name ?? (model && model.id);
  if (Object.prototype.hasOwnProperty.call(overrides, "design_grid")) {
    throw new Error(
      `registerModelPackage("${name ?? "<model>"}"): design_grid belongs on a task; ` +
      `register it with registerTask(...).`
    );
  }
  const { valid, problems } = validateModel(model);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    throw new Error(
      `registerModelPackage("${name ?? "<model>"}"): invalid model package:\n  - ` +
      errors.map((e) => e.message).join("\n  - ")
    );
  }
  for (const w of problems.filter((p) => p.level === "warn")) {
    console.warn(`registerModelPackage("${name}"): ${w.message}`);
  }
  if (!valid) {
    throw new Error(`registerModelPackage("${name ?? "<model>"}"): invalid model package.`);
  }

  registerModel(name, {
    moduleUrl: model.moduleUrl,
    wasmUrl: model.wasmUrl,
    prior: model.prior,
    params: model.params,
    designKeys: model.designKeys,
    responseSpace: model.responseSpace,
    responseProb: model.responseProb,
    responseProbs: model.responseProbs,
    responseDensity: model.responseDensity,
    responseDensityFactory: model.responseDensityFactory,
    conditionalEntropy: model.conditionalEntropy,
    responseMoments: model.responseMoments,
    responseSupport: model.responseSupport,
    responseSampler: model.responseSampler,
    buildData: model.buildData,
    toStanData: model.toStanData,
    stanData: model.stanData,
    posterior_display: model.posterior_display,
    stan: overrides.stan ?? model.stan,
    n_trials: overrides.n_trials ?? model.n_trials,
    testlet_size: overrides.testlet_size ?? model.testlet_size,
    stopping: overrides.stopping ?? model.stopping,
  });
  return name;
}

const jsPsychADO = {
  registerTask,
  registerModel,
  registerModelPackage,
  validateTask,
  validateModel,
  prepareModels,
  createTimeline,
  // Design-grid axis helpers (see ado/grid.js).
  arange,
  linspace,
  // Stan data-block builder (see ado/stan_data.js).
  makeStanDataBuilder,
};

export {
  jsPsychADO,
  registerTask,
  registerModel,
  registerModelPackage,
  validateTask,
  validateModel,
  prepareModels,
  createTimeline,
  arange,
  linspace,
  makeStanDataBuilder,
  // Advanced / internal — exported for power users and the test suite, NOT part of the
  // stable jsPsychADO façade; may change without a major version bump while pre-1.0.
  validateTaskModelPair,
  parseStanPriors,
  buildAdapter,
  labelsToConfig,
};
export default jsPsychADO;
