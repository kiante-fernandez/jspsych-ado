// jspsych-ado/index.js — package facade.
//
// The public authoring path is controller-based:
//   const ado = jsPsychADO.createController(jsPsych, { model, design_grid, stan });
//   const timeline = ado.createTimeline(trial);

import { createStanAdoController } from "./controllers/stan_ado_controller.js";
import { createMockAdoController } from "./controllers/mock_ado_controller.js";
import { createAdoTimeline } from "./ado/ado_timeline.js";
import { createSeededRng } from "./ado/ado_simulation.js";
import { arange, linspace } from "./ado/grid.js";
import { makeStanDataBuilder, validateStanDataSpec } from "./ado/stan_data.js";
import {
  enumerateDesigns,
  getResponseProbsFunction,
  samplePriorDraws,
  validateResponseProbs,
} from "./ado/mi_engine.js";

const DEFAULT_STAN = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };
const DEFAULT_N_TRIALS = 42;
const CONTROLLER_MODES = new Set(["stan", "mock"]);

function createController(jsPsych, config = {}) {
  if (!config || typeof config !== "object") {
    throw new Error("createController: config must be an object.");
  }
  if (!config.model || typeof config.model !== "object") {
    throw new Error("createController: provide a model package as `model`.");
  }
  if (config.design_grid == null) {
    throw new Error("createController: `design_grid` is required.");
  }

  const model = config.model;
  const adapter = buildModelAdapter(model, "createController");
  validateDesignGridForModel(config.design_grid, adapter, adapter.id);

  let get_current_design = null;
  let recording_open = false;
  let response_recorded = false;
  let recorded_response = undefined;
  function currentDesignOrThrow(context) {
    const design = get_current_design ? get_current_design() : null;
    if (!design) {
      throw new Error(`${context}: no current ADO design is available yet.`);
    }
    return design;
  }

  const ado = {
    getDesign() {
      return { ...currentDesignOrThrow("getDesign") };
    },

    evaluateDesignVariable(key) {
      const design = currentDesignOrThrow("evaluateDesignVariable");
      if (!Object.prototype.hasOwnProperty.call(design, key)) {
        throw new Error(`evaluateDesignVariable: current design has no field "${key}".`);
      }
      return design[key];
    },

    designVariable(key) {
      return () => ado.evaluateDesignVariable(key);
    },

    recordResponse(response) {
      if (!recording_open) {
        throw new Error("recordResponse: call this from the adaptive trial's on_finish callback.");
      }
      if (response_recorded) {
        throw new Error("recordResponse: only one response can be recorded for an adaptive trial.");
      }
      recorded_response = response;
      response_recorded = true;
    },

    createTimeline(trial_or_trials, timeline_config = {}) {
      const uses_trial_factory = typeof trial_or_trials === "function";
      const static_trial_info = uses_trial_factory
        ? null
        : normalizeControllerTrials(trial_or_trials, timeline_config.response_trial_index);
      const response_trial = static_trial_info
        ? static_trial_info.trials[static_trial_info.response_trial_index]
        : null;

      const n_trials = timeline_config.n_trials ?? config.n_trials ?? model.n_trials ?? DEFAULT_N_TRIALS;
      const testlet_size = normalizeTestletSize(
        timeline_config.testlet_size ?? config.testlet_size ?? model.testlet_size
      );
      const stopping = timeline_config.stopping ?? config.stopping ?? model.stopping ?? null;
      const controller_mode = normalizeControllerMode(
        timeline_config.controller ?? timeline_config.controller_mode ?? config.controller ?? config.controller_mode
      );
      const design_strategy = timeline_config.design_strategy ?? config.design_strategy ?? "ado";
      const effective_design_strategy = controller_mode === "mock" ? null : design_strategy;
      const debug = resolveDebug(timeline_config.debug ?? config.debug ?? "url");
      const response_labels = inferResponseLabels(
        response_trial,
        adapter.responseSpace,
        timeline_config.response_labels ?? config.response_labels
      );
      validateResponseLabels(response_labels, adapter.responseSpace);
      const choices = timeline_config.choices ?? config.choices ?? (response_trial && response_trial.choices);
      const stan = {
        ...DEFAULT_STAN,
        ...model.stan,
        ...config.stan,
        ...timeline_config.stan,
      };

      const adaptive_controller = controller_mode === "mock"
        ? createMockAdoController({
          grid_design: config.design_grid,
          params: adapter.params,
          n_trials,
          testlet_size,
          stopping,
        })
        : createStanAdoController({
          model: adapter,
          grid_design: config.design_grid,
          stan,
          n_trials,
          testlet_size,
          stopping,
          session_id: timeline_config.session_id ?? config.session_id,
          design_strategy: effective_design_strategy,
          design_seed: timeline_config.design_seed ?? config.design_seed ?? null,
        });

      const run_context = {
        debug,
        ado_mode: controller_mode === "mock"
          ? "mock"
          : (effective_design_strategy === "random" ? "random" : "stan"),
        controller_mode,
        design_strategy: effective_design_strategy,
        model_id: adapter.id,
        posterior_display: model.posterior_display,
      };

      return createAdoTimeline(jsPsych, adaptive_controller, {
        n_trials,
        testlet_size,
        stopping,
        response_labels,
        choices,
        describeDesign: timeline_config.describeDesign ?? config.describeDesign,
        getChoiceTrials(ctx) {
          get_current_design = ctx.getDesign;
          const materialized = uses_trial_factory
            ? trial_or_trials({
              ...ctx,
              ado,
              choices,
              response_labels,
            })
            : static_trial_info.trials;
          const { trials, response_trial_index } = normalizeControllerTrials(
            materialized,
            timeline_config.response_trial_index
          );
          return trials.map((trial, index) => {
            const cloned = { ...trial };
            if (index !== response_trial_index) {
              return cloned;
            }

            const inner_on_finish = cloned.on_finish;
            cloned.on_finish = async function(data) {
              recording_open = true;
              response_recorded = false;
              recorded_response = undefined;

              try {
                if (inner_on_finish) {
                  await Promise.resolve(inner_on_finish.call(this, data));
                }
              } finally {
                recording_open = false;
              }

              if (!response_recorded) {
                throw new Error("ADO trial finished without calling ado.recordResponse(...).");
              }
              data.__ado_response = recorded_response;
            };
            cloned.__ado_is_response = true;
            return cloned;
          });
        },
      }, run_context);
    },
  };

  return ado;
}

function normalizeControllerMode(value) {
  if (value == null) {
    return "stan";
  }
  if (!CONTROLLER_MODES.has(value)) {
    throw new Error(`createController: controller must be "stan" or "mock", got "${value}".`);
  }
  return value;
}

function normalizeTestletSize(value) {
  if (value == null) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`ado.createTimeline: testlet_size must be a positive integer, got ${value}`);
  }
  return value;
}

function resolveDebug(value) {
  if (value === "url") {
    return isDebugUrlEnabled();
  }
  return Boolean(value);
}

function isDebugUrlEnabled() {
  if (typeof globalThis === "undefined" || !globalThis.location) {
    return false;
  }
  const params = new URLSearchParams(globalThis.location.search || "");
  if (!params.has("debug")) {
    return false;
  }
  const value = params.get("debug");
  if (value == null || value === "") {
    return true;
  }
  return !/^(0|false|off|no)$/i.test(value);
}

function buildModelAdapter(model, context = "model") {
  const { valid, problems } = validateModel(model);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    throw new Error(
      `${context}("${model && model.id ? model.id : "<model>"}"): invalid model package:\n  - ` +
      errors.map((e) => e.message).join("\n  - ")
    );
  }
  for (const w of problems.filter((p) => p.level === "warn")) {
    console.warn(`${context}("${model.id}"): ${w.message}`);
  }
  if (!valid) {
    throw new Error(`${context}("${model.id}"): invalid model package.`);
  }

  const { responseProb, responseProbs, toStanData, buildData, stanData } = model;
  const adaptedBuildData = buildData
    ? buildData
    : toStanData
    ? (trials) => toStanData(trials.map(({ choice, ...design }) => ({ design, response: choice })))
    : makeStanDataBuilder({ stanData, responseSpace: model.responseSpace });

  return {
    id: model.id,
    params: model.params,
    prior: model.prior,
    moduleUrl: model.moduleUrl,
    wasmUrl: model.wasmUrl ?? null,
    designKeys: model.designKeys,
    responseSpace: model.responseSpace,
    buildData: adaptedBuildData,
    responseProb,
    responseProbs: responseProbs || (typeof responseProb === "function"
      ? (design, draw) => {
          const p = responseProb(design, draw);
          return [1 - p, p];
        }
      : null),
  };
}

function validateDesignGridForModel(grid_design, model, modelName) {
  const problems = [];
  let designs = [];
  try {
    designs = enumerateDesigns(grid_design);
  } catch (error) {
    problems.push(`design_grid could not be enumerated: ${String((error && error.message) || error)}`);
  }

  if (designs.length === 0) {
    problems.push("design_grid produced no candidate designs");
  }

  const required_keys = new Set(model.designKeys || []);
  const seen_missing = new Set();
  designs.forEach((design, index) => {
    for (const key of required_keys) {
      if (!(key in design) && !seen_missing.has(key)) {
        problems.push(`design_grid row ${index} is missing model design key "${key}"`);
        seen_missing.add(key);
      }
    }
  });

  const sample_design = designs[0] || null;
  if (sample_design) {
    try {
      const sample_draw = samplePriorDraws(model.prior, 1, createSeededRng(8675309))[0];
      const responseProbs = getResponseProbsFunction(model);
      const probs = validateResponseProbs(responseProbs(sample_design, sample_draw), "response likelihood probe");
      const response_count = getResponseCount(model.responseSpace);
      if (response_count != null && probs.length !== response_count) {
        problems.push(`response likelihood returned ${probs.length} probabilities; expected ${response_count}`);
      }
    } catch (error) {
      problems.push(`response likelihood probe failed: ${String((error && error.message) || error)}`);
    }

    try {
      const sample_choice = getResponseCount(model.responseSpace) === 2 ? 1 : 0;
      const stan_data = model.buildData([{ ...sample_design, choice: sample_choice }]);
      if (!stan_data || typeof stan_data !== "object") {
        problems.push("buildData probe did not return a Stan data object");
      } else {
        const undefined_path = findUndefined(stan_data);
        if (undefined_path) {
          problems.push(`buildData probe returned undefined at ${undefined_path}`);
        }
      }
    } catch (error) {
      problems.push(`buildData probe failed: ${String((error && error.message) || error)}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `model "${modelName}" is incompatible with design_grid: ` +
      problems.join("; ")
    );
  }
}

function normalizeControllerTrials(trial_or_trials, response_trial_index) {
  const trials = Array.isArray(trial_or_trials) ? trial_or_trials : [trial_or_trials];
  if (trials.length === 0) {
    throw new Error("ado.createTimeline: provide at least one jsPsych trial.");
  }
  for (const trial of trials) {
    if (!trial || typeof trial !== "object") {
      throw new Error("ado.createTimeline: trials must be jsPsych trial objects.");
    }
  }

  let index = response_trial_index;
  if (index == null) {
    const marked = [];
    for (let i = 0; i < trials.length; i++) {
      if (trials[i].__ado_is_response) {
        marked.push(i);
      }
    }
    index = marked.length === 1 ? marked[0] : (trials.length - 1);
  }
  if (!Number.isInteger(index) || index < 0 || index >= trials.length) {
    throw new Error(`ado.createTimeline: response_trial_index must be between 0 and ${trials.length - 1}.`);
  }
  return { trials, response_trial_index: index };
}

function inferResponseLabels(response_trial, responseSpace, explicit_labels) {
  if (explicit_labels != null) {
    return labelsToConfig(explicit_labels);
  }
  if (response_trial && Array.isArray(response_trial.choices)) {
    return labelsToConfig(response_trial.choices);
  }
  const response_count = getResponseCount(responseSpace);
  if (response_count != null) {
    return Object.fromEntries(
      Array.from({ length: response_count }, (_value, index) => [index, String(index)])
    );
  }
  return {};
}

function validateResponseLabels(response_labels, responseSpace) {
  const response_count = getResponseCount(responseSpace);
  if (response_count == null) {
    return;
  }
  const label_count = countLabels(response_labels);
  if (label_count !== response_count) {
    throw new Error(`ado.createTimeline: response_labels has ${label_count} entries; expected ${response_count}.`);
  }
}

function labelsToConfig(labels) {
  if (Array.isArray(labels)) {
    return Object.fromEntries(labels.map((label, index) => [index, label]));
  }
  return labels;
}

function getResponseCount(responseSpace) {
  if (!responseSpace || typeof responseSpace.type !== "string") {
    return null;
  }
  if (responseSpace.type === "binary") {
    return 2;
  }
  if (responseSpace.type === "categorical" && Number.isInteger(responseSpace.n_categories) && responseSpace.n_categories >= 2) {
    return responseSpace.n_categories;
  }
  return null;
}

function validateResponseSpace(responseSpace, context) {
  if (!responseSpace || typeof responseSpace.type !== "string") {
    return `${context}: responseSpace.type must be a string.`;
  }
  if (responseSpace.type === "binary") {
    return null;
  }
  if (responseSpace.type === "categorical") {
    if (!Number.isInteger(responseSpace.n_categories) || responseSpace.n_categories < 2) {
      return `${context}: categorical responseSpace needs integer n_categories >= 2.`;
    }
    return null;
  }
  return `${context}: responseSpace type "${responseSpace.type}" is not supported.`;
}

function countLabels(labels) {
  if (Array.isArray(labels)) {
    return labels.length;
  }
  if (labels && typeof labels === "object") {
    return Object.keys(labels).length;
  }
  return null;
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

const SAMPLEABLE_PRIOR_DISTS = new Set(["lognormal", "normal", "halfnormal"]);

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
  if (typeof model.wasmUrl !== "string" || !model.wasmUrl) {
    warn("`wasmUrl` is not set (e.g. new URL(\"./main.wasm\", import.meta.url).href). " +
      "Static-served deployments still work, but bundlers (Vite/webpack) hash main.wasm, so the model would 404 its wasm at runtime (#57).");
  }
  if (!Array.isArray(model.designKeys) || model.designKeys.length === 0) {
    err("`designKeys` must be a non-empty array.");
  }
  if (!model.responseSpace || typeof model.responseSpace.type !== "string") {
    err("`responseSpace.type` must be a string.");
  } else {
    const response_space_error = validateResponseSpace(model.responseSpace, "validateModel");
    if (response_space_error) {
      err(response_space_error);
    }
  }
  if (model.stanData != null) {
    for (const p of validateStanDataSpec(model.stanData)) err(p);
  } else if (typeof model.buildData !== "function" && typeof model.toStanData !== "function") {
    err("provide a `stanData` map (preferred), or `buildData(trials)`, or `toStanData(rows)`.");
  }
  if (model.responseSpace && model.responseSpace.type === "categorical") {
    if (typeof model.responseProbs !== "function") {
      err("categorical models must provide `responseProbs(design, draw)`.");
    }
  } else if (typeof model.responseProb !== "function" && typeof model.responseProbs !== "function") {
    err("`responseProb(design, draw)` or `responseProbs(design, draw)` must be a function.");
  }
  if (typeof model.choiceProbLL === "function") {
    err("`choiceProbLL` has been replaced by `responseProb` for binary models or `responseProbs` for categorical models.");
  }
  for (const k of ["design_grid", "presentation", "choices", "response_labels", "responseToOutcome", "task"]) {
    if (model[k] != null) {
      err(`\`${k}\` belongs in experiment/trial code, not in a model package.`);
    }
  }

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

  if (opts.sampleDesign && (typeof model.responseProb === "function" || typeof model.responseProbs === "function")) {
    try {
      const responseProbs = getResponseProbsFunction(model);
      const probs = validateResponseProbs(responseProbs(opts.sampleDesign, opts.sampleDraw || {}), "validateModel");
      const response_count = getResponseCount(model.responseSpace);
      if (response_count != null && probs.length !== response_count) {
        err(`response likelihood returned ${probs.length} probabilities; expected ${response_count}.`);
      }
    } catch (e) {
      err(`response likelihood threw on the sample design: ${String((e && e.message) || e)}.`);
    }
  }

  const valid = !problems.some((pr) => pr.level === "error");
  return { valid, problems };
}

function parseStanPriors(stanCode, paramSpecs) {
  const prior = {};
  const source = stanCode
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

  for (const p of paramSpecs) {
    const name = typeof p === "string" ? p : p.name;
    const meta = typeof p === "string" ? {} : p;

    const declaredPositive =
      meta.lower === 0 ||
      new RegExp(`real\\s*<[^>]*lower\\s*=\\s*0\\s*(?:,[^>]*)?>\\s*${name}\\b`).test(source);

    const match = new RegExp(`\\b${name}\\s*~\\s*(\\w+)\\s*\\(([^;]*)\\)\\s*;`).exec(source);
    if (!match) {
      throw new Error(
        `parseStanPriors: no prior found for "${name}" in the Stan source. Add a sampling ` +
        `statement (e.g. ${name} ~ normal(...);) or pass an explicit \`prior\`.`
      );
    }
    const dist = match[1];
    const args = match[2].split(",").map((s) => Number(s.trim()));
    if (args.some(Number.isNaN)) {
      throw new Error(
        `parseStanPriors: could not read numeric prior arguments for "${name}" ("${match[2].trim()}"). ` +
        `Pass an explicit \`prior\`.`
      );
    }
    if ((dist === "normal" || dist === "lognormal") && args.length !== 2) {
      throw new Error(
        `parseStanPriors: "${name}" prior ${dist}(...) expects 2 numeric arguments but got ` +
        `${args.length} ("${match[2].trim()}"). Pass an explicit \`prior\`.`
      );
    }

    if (dist === "lognormal") {
      prior[name] = { dist: "lognormal", meanlog: args[0], sdlog: args[1] };
    } else if (dist === "normal") {
      if (declaredPositive) {
        if (Math.abs(args[0]) > 1e-9) {
          throw new Error(
            `parseStanPriors: "${name}" is lower-bounded at 0 with a non-zero-mean normal prior ` +
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
        `parseStanPriors: unsupported Stan prior "${dist}(...)" for "${name}". Auto-parse supports ` +
        `normal, lognormal, and normal+<lower=0> (half-normal). Pass an explicit \`prior\` for others.`
      );
    }
  }

  return prior;
}

const jsPsychADO = {
  createController,
  validateModel,
  arange,
  linspace,
  makeStanDataBuilder,
};

export {
  jsPsychADO,
  validateModel,
  parseStanPriors,
  arange,
  linspace,
  makeStanDataBuilder,
};
export default jsPsychADO;
