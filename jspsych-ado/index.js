// jspsych-ado/index.js — the jsPsychADO façade (package entry point).
//
// Researchers register two composable pieces:
//   - a task:  design grid, presentation, choices, and response labels
//   - a model: parameters, priors, likelihood, Stan data builder, and WASM module
//
// Then createTimeline validates the task/model pair and builds the standard ADO
// timeline around the in-browser Stan controller.

import { createStanAdoController } from "./controllers/stan_ado_controller.js";
import { createAdoTimeline } from "./ado/ado_timeline.js";
import { createSeededRng } from "./ado/ado_simulation.js";
import { enumerateDesigns, samplePriorDraws } from "./ado/mi_engine.js";

const DEFAULT_STAN = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };
const DEFAULT_N_TRIALS = 42;
const DEFAULT_TOKEN = "1234";

const MODEL_REGISTRY = new Map();  // name -> entry
const TASK_REGISTRY = new Map();   // name -> task spec
const _compileCache = new Map();   // stanCode -> moduleUrl (per page session)

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
 * @param {Object} spec.responseSpace - Currently {type:"binary"}.
 * @param {Object} spec.presentation - getChoiceTrials(ctx) OR makeStimulus(design).
 * @param {string[]} [spec.choices] - Button/key labels in index order.
 * @param {string[]|Object} spec.response_labels - ["SS","LL"] or {0:"SS",1:"LL"}.
 * @param {Function} [spec.responseToOutcome] - (design, choiceIndex) => 0|1.
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
 * @param {Object}   spec.responseSpace   - Currently {type:"binary"}.
 * @param {Function} spec.responseProb    - (design, draw) => P(outcome = 1).
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
  for (const k of ["params", "designKeys", "responseSpace", "responseProb"]) {
    if (spec[k] == null) throw new Error(`registerModel("${name}"): missing required field "${k}".`);
  }
  if (spec.toStanData == null && spec.buildData == null) {
    throw new Error(
      `registerModel("${name}"): provide toStanData([{design,response}]) or buildData([{...design,choice}]).`
    );
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
  if (!spec.responseSpace || typeof spec.responseSpace.type !== "string") {
    throw new Error(`registerModel("${name}"): responseSpace.type must be a string.`);
  }
  if (typeof spec.responseProb !== "function") {
    throw new Error(`registerModel("${name}"): responseProb(design, draw) must be a function.`);
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

  const controller = createStanAdoController({
    model: adapter,
    grid_design,
    stan,
    n_trials,
    testlet_size,
    session_id: config.session_id,
    design_strategy: config.design_strategy ?? "ado",
    design_seed: config.design_seed ?? null,
  });

  const timeline_config = {
    n_trials,
    testlet_size,
    response_labels,
    presentation: task.presentation,
    choices: task.choices,
    responseToOutcome: task.responseToOutcome,
    task: task.id ?? config.task,
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
  const { spec, name, paramNames, prior, moduleUrl } = entry;
  const { responseProb, toStanData, buildData } = spec;

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
    designKeys: spec.designKeys,
    responseSpace: spec.responseSpace,
    buildData: adaptedBuildData,
    responseProb,
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

function validateTaskModelPair(task, model, taskName, modelName) {
  const problems = [];
  const task_keys = new Set(task.designKeys || []);
  for (const key of model.designKeys || []) {
    if (!task_keys.has(key)) {
      problems.push(`missing design key "${key}"`);
    }
  }

  const task_type = task.responseSpace && task.responseSpace.type;
  const model_type = model.responseSpace && model.responseSpace.type;
  if (task_type !== model_type) {
    problems.push(`responseSpace mismatch: task has "${task_type}", model has "${model_type}"`);
  } else if (task_type !== "binary") {
    problems.push(`responseSpace type "${task_type}" is not supported yet`);
  }

  let sample_design = null;
  try {
    const designs = enumerateDesigns(task.design_grid);
    sample_design = designs[0] || null;
    if (!sample_design) {
      problems.push("task design_grid produced no candidate designs");
    } else {
      const required_keys = new Set([...(task.designKeys || []), ...(model.designKeys || [])]);
      const seen_missing = new Set();
      designs.forEach((design, index) => {
        for (const key of required_keys) {
          if (!(key in design) && !seen_missing.has(key)) {
              problems.push(`task design_grid row ${index} is missing design key "${key}"`);
              seen_missing.add(key);
          }
        }
      });
    }
  } catch (e) {
    problems.push(`task design_grid could not be enumerated: ${String((e && e.message) || e)}`);
  }

  let sample_draw = null;
  if (sample_design) {
    try {
      sample_draw = samplePriorDraws(model.prior, 1, createSeededRng(8675309))[0];
      const p = model.responseProb(sample_design, sample_draw);
      if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
        problems.push(`responseProb(sampleDesign, sampleDraw) returned ${p}; expected a probability in [0, 1]`);
      }
    } catch (e) {
      problems.push(`responseProb probe failed: ${String((e && e.message) || e)}`);
    }

    try {
      const stan_data = model.buildData([{ ...sample_design, choice: 1 }]);
      if (!stan_data || typeof stan_data !== "object") {
        problems.push("buildData probe did not return a Stan data object");
      } else {
        const undefined_path = findUndefined(stan_data);
        if (undefined_path) {
          problems.push(`buildData probe returned undefined at ${undefined_path}`);
        }
      }
    } catch (e) {
      problems.push(`buildData probe failed: ${String((e && e.message) || e)}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `model "${modelName}" is incompatible with task "${taskName}": ` +
      problems.join("; ")
    );
  }
}

function findUndefined(value, path = "data") {
  if (value === undefined) {
    return path;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUndefined(value[i], `${path}[${i}]`);
      if (found) {
        return found;
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findUndefined(child, `${path}.${key}`);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// POST a Stan source string to the compile server and return the main.js URL.
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

// Derive the engine's JS prior {param:{dist,...}} from the Stan source.
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

// ---------------------------------------------------------------------------
// Validation and one-call registration for committed packages
// ---------------------------------------------------------------------------

const SAMPLEABLE_PRIOR_DISTS = new Set(["lognormal", "normal", "halfnormal"]);

/**
 * Validate a task package before registration.
 *
 * @param {Object} task - Task package default export.
 * @returns {{valid: boolean, problems: Array<{level: "error"|"warn", message: string}>}}
 */
function validateTask(task) {
  const problems = [];
  const err = (message) => problems.push({ level: "error", message });
  const warn = (message) => problems.push({ level: "warn", message });

  if (!task || typeof task !== "object") {
    return { valid: false, problems: [{ level: "error", message: "validateTask: task must be an object." }] };
  }
  if (typeof task.id !== "string" || !task.id) err("`id` must be a non-empty string.");
  if (task.design_grid == null) err("`design_grid` is required.");
  if (!Array.isArray(task.designKeys) || task.designKeys.length === 0) {
    err("`designKeys` must be a non-empty array.");
  }
  if (!task.responseSpace || typeof task.responseSpace.type !== "string") {
    err("`responseSpace.type` must be a string.");
  }

  const presentation = task.presentation;
  if (!presentation || (typeof presentation.getChoiceTrials !== "function" && typeof presentation.makeStimulus !== "function")) {
    err("`presentation` must provide getChoiceTrials(ctx) or makeStimulus(design).");
  }
  if (task.response_labels == null) err("`response_labels` is required.");
  if (task.choices == null && presentation && typeof presentation.makeStimulus === "function") {
    warn("`choices` is missing; the single-button presentation path needs choices in index order.");
  }

  if (task.design_grid != null) {
    try {
      const designs = enumerateDesigns(task.design_grid);
      if (designs.length === 0) {
        err("`design_grid` produced no candidate designs.");
      }
    } catch (e) {
      err(`design_grid could not be enumerated: ${String((e && e.message) || e)}.`);
    }
  }

  const valid = !problems.some((pr) => pr.level === "error");
  return { valid, problems };
}

/**
 * Validate a model-package default export (the shape under models/<name>/model.js).
 *
 * @param {Object} model - The model package default export.
 * @param {Object} [opts]
 * @param {Object} [opts.sampleDesign] - A design to probe responseProb/buildData with.
 * @param {Object} [opts.sampleDraw]   - A parameter draw to probe responseProb with.
 * @returns {{valid: boolean, problems: Array<{level: "error"|"warn", message: string}>}}
 */
function validateModel(model, opts = {}) {
  const problems = [];
  const err = (message) => problems.push({ level: "error", message });
  const warn = (message) => problems.push({ level: "warn", message });

  if (!model || typeof model !== "object") {
    return { valid: false, problems: [{ level: "error", message: "validateModel: model must be an object (the model package default export)." }] };
  }

  if (typeof model.id !== "string" || !model.id) err("`id` must be a non-empty string.");

  const params = Array.isArray(model.params) ? model.params : null;
  if (!params || params.length === 0 || !params.every((p) => typeof p === "string")) {
    err("`params` must be a non-empty array of parameter-name strings.");
  }
  if (typeof model.moduleUrl !== "string" || !model.moduleUrl) {
    err("`moduleUrl` must be the compiled module URL (e.g. new URL(\"./main.js\", import.meta.url).href).");
  }
  if (!Array.isArray(model.designKeys) || model.designKeys.length === 0) {
    err("`designKeys` must be a non-empty array.");
  }
  if (!model.responseSpace || typeof model.responseSpace.type !== "string") {
    err("`responseSpace.type` must be a string.");
  }
  if (typeof model.buildData !== "function") err("`buildData(trials)` must be a function.");
  if (typeof model.responseProb !== "function") err("`responseProb(design, draw)` must be a function.");
  if (typeof model.choiceProbLL === "function") err("`choiceProbLL` has been renamed to `responseProb`.");
  for (const k of ["design_grid", "presentation", "choices", "response_labels", "responseToOutcome", "task"]) {
    if (model[k] != null) {
      err(`\`${k}\` belongs on a task package, not a model package.`);
    }
  }

  // Prior must cover every parameter, with a family the first-design sampler can draw.
  if (params && model.prior && typeof model.prior === "object") {
    for (const p of params) {
      const spec = model.prior[p];
      if (!spec || typeof spec !== "object") {
        err(`prior for "${p}" is missing; the engine samples the prior to choose the first design.`);
      } else if (!SAMPLEABLE_PRIOR_DISTS.has(spec.dist)) {
        warn(`prior for "${p}" uses dist "${spec.dist}", which the first-design sampler can't draw ` +
          `(supports ${[...SAMPLEABLE_PRIOR_DISTS].join(", ")}). The first design would fail.`);
      }
    }
  } else if (params) {
    err("`prior` must be an object mapping each parameter to a {dist, ...} spec matching the .stan priors.");
  }

  // Optional runtime probe.
  if (opts.sampleDesign && typeof model.responseProb === "function") {
    try {
      const p = model.responseProb(opts.sampleDesign, opts.sampleDraw || {});
      if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
        err(`responseProb(sampleDesign, sampleDraw) returned ${p}; expected a probability in [0, 1].`);
      }
    } catch (e) {
      err(`responseProb threw on the sample design: ${String((e && e.message) || e)}.`);
    }
  }

  const valid = !problems.some((pr) => pr.level === "error");
  return { valid, problems };
}

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
    prior: model.prior,
    params: model.params,
    designKeys: model.designKeys,
    responseSpace: model.responseSpace,
    responseProb: model.responseProb,
    buildData: model.buildData,
    posterior_display: model.posterior_display,
    stan: overrides.stan ?? model.stan,
    n_trials: overrides.n_trials ?? model.n_trials,
    testlet_size: overrides.testlet_size ?? model.testlet_size,
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
  parseStanPriors,
  labelsToConfig,
  buildAdapter,
};
export default jsPsychADO;
