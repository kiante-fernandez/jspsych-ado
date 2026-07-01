// src/index.js — the jsPsychADO façade (package entry point).
//
// The public authoring path is controller-based (#135):
//
//   const ado = jsPsychADO.createController(jsPsych, { model, design_grid, stan });
//
//   const trial = {
//     type: jsPsychHtmlButtonResponse,
//     stimulus: () => `${ado.evaluateDesignVariable("r_ss")} now or ...`,
//     choices: ["Sooner", "Later"],
//     on_finish: (data) => ado.recordResponse(data.response),
//   };
//
//   jsPsych.run([intro, ...ado.createTimeline(trial), end]);
//
// The task layer is ordinary user-authored jsPsych trials; ADO owns the adaptive
// controller/runtime. ado.createTimeline(...) owns the scheduling guarantee:
// response -> model update -> next design -> next trial render (jsPsych 8 awaits
// the composed async on_finish). Model validation lives in validation.js and the
// Stan-source helpers (prior parsing + remote compile) in models/stan_source.js.

import { createStanAdoController } from "./controllers/stan_ado_controller.js";
import { createMockAdoController } from "./controllers/mock_ado_controller.js";
import { createAdoTimeline } from "./ado/ado_timeline.js";
import { arange, linspace } from "./ado/grid.js";
import { makeStanDataBuilder } from "./ado/stan_data.js";
import {
  createSeededRng,
  simulateCategoricalChoice,
  simulateContinuousResponse,
} from "./ado/ado_simulation.js";
import { makeChoiceSimulationOptions } from "./ado/simulation_hooks.js";
import {
  validateModel,
  validateDesignGridForModel,
  getResponseCount,
  isContinuous,
} from "./validation.js";
import { parseStanPriors, compileToModuleUrl } from "./models/stan_source.js";

const DEFAULT_STAN = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };
const DEFAULT_N_TRIALS = 42;
const DEFAULT_TOKEN = "1234";
const CONTROLLER_MODES = new Set(["stan", "mock"]);
const _compileCache = new Map(); // `${server}\n${stanCode}` -> moduleUrl (per page session)

// ---------------------------------------------------------------------------
// createController
// ---------------------------------------------------------------------------

/**
 * Create an ADO controller handle for one model + design grid.
 *
 * The handle exposes design accessors for ordinary jsPsych trials
 * (evaluateDesignVariable / designVariable / getDesign), the response boundary
 * (recordResponse, called from the adaptive trial's on_finish), the live
 * posterior (getState), and createTimeline(trialOrTrials, opts) which wraps the
 * user's trials into the adaptive loop.
 *
 * @param {Object} jsPsych - jsPsych instance returned by initJsPsych().
 * @param {Object} config
 * @param {Object} config.model - A model package (see models/README.md).
 * @param {Object|Array<Object>} config.design_grid - Candidate designs: an object of
 *   value arrays (cartesian product) or an explicit array of design objects.
 * @param {Object} [config.stan] - Sampler overrides { num_chains, num_warmup, num_samples, seed }.
 * @param {number} [config.n_trials=42] - Adaptive trial count.
 * @param {number} [config.testlet_size=1] - Choice trials shown between Stan refits.
 * @param {Object} [config.stopping] - EIG-based early stopping (#21); omit for fixed length.
 * @param {string} [config.controller="stan"] - "stan" (live inference) or "mock" (no-WASM dev).
 * @param {string} [config.design_strategy="ado"] - "ado" (MI-optimal) or "random" (recovery baseline).
 * @param {?number} [config.design_seed] - Optional seed for prior/random design selection.
 * @param {string} [config.session_id] - Session id saved into the data.
 * @param {boolean|string} [config.debug="url"] - true/false, or "url" to honor ?debug=1.
 * @param {string[]|Object} [config.response_labels] - Outcome labels; inferred from the
 *   response trial's static choices when omitted (discrete responses only).
 * @param {Object} [config.simulate] - Synthetic-participant config for jsPsych.simulate():
 *   { participant: {param: value, ...}, rt_ms?, seed?, respond?(design, sim) }.
 * @returns {Object} The ado controller handle.
 */
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

  const adapter = buildModelAdapter(config.model, "createController");
  validateDesignGridForModel(config.design_grid, adapter, adapter.id);

  // The facade state below belongs to the ACTIVE run (one createTimeline call).
  // Sequential reuse (a practice run then a main run from the same handle) works
  // because each timeline re-activates itself via on_timeline_start before any of
  // its trials evaluate parameters; concurrent runs are not supported (jsPsych
  // runs one timeline at a time).
  let active_run = null;

  function requireActiveRun(context) {
    if (!active_run) {
      throw new Error(`${context}: no adaptive run is active. Call ado.createTimeline(...) first.`);
    }
    return active_run;
  }

  function currentDesignOrThrow(context) {
    const design = requireActiveRun(context).getDesign();
    if (!design) {
      throw new Error(`${context}: no current ADO design is available yet.`);
    }
    return design;
  }

  const ado = {
    /** A copy of the current design object. */
    getDesign() {
      return { ...currentDesignOrThrow("getDesign") };
    },

    /** The current value of one design variable (use inside dynamic trial parameters). */
    evaluateDesignVariable(key) {
      const design = currentDesignOrThrow("evaluateDesignVariable");
      if (!Object.prototype.hasOwnProperty.call(design, key)) {
        throw new Error(`evaluateDesignVariable: current design has no field "${key}".`);
      }
      return design[key];
    },

    /** A function-valued trial parameter that resolves the design variable at run time. */
    designVariable(key) {
      return () => ado.evaluateDesignVariable(key);
    },

    /** The latest controller state (posterior summaries, next-design diagnostics). */
    getState() {
      const run = requireActiveRun("getState");
      const state = run.getState();
      return state ? { ...state } : null;
    },

    /**
     * Record the model outcome for the current adaptive trial. Call exactly once
     * from the adaptive trial's on_finish, after mapping the plugin's raw response
     * to the model's outcome coding (binary: 0/1; categorical: 0..K-1;
     * continuous: a finite number).
     */
    recordResponse(response) {
      const run = requireActiveRun("recordResponse");
      run.recordResponse(response);
    },

    /**
     * Wrap user-authored jsPsych trials into the adaptive ADO loop.
     *
     * @param {Object|Array<Object>|Function} trial_or_trials - One jsPsych trial, an
     *   array of trials shown per adaptive step (fixation, stimulus, response, ...),
     *   or a factory (ctx) => trial(s) for fully dynamic steps.
     * @param {Object} [timeline_config] - Per-timeline overrides of the controller
     *   config (n_trials, stopping, testlet_size, controller, design_strategy, debug,
     *   response_labels, response_trial_index, describeDesign, simulate, ...).
     * @returns {Array} jsPsych timeline fragment to spread into jsPsych.run([...]).
     */
    createTimeline(trial_or_trials, timeline_config = {}) {
      const uses_trial_factory = typeof trial_or_trials === "function";
      const static_trial_info = uses_trial_factory
        ? null
        : normalizeControllerTrials(trial_or_trials, timeline_config.response_trial_index);
      const response_trial = static_trial_info
        ? static_trial_info.trials[static_trial_info.response_trial_index]
        : null;

      const n_trials =
        timeline_config.n_trials ?? config.n_trials ?? config.model.n_trials ?? DEFAULT_N_TRIALS;
      const testlet_size = normalizeTestletSize(
        timeline_config.testlet_size ?? config.testlet_size ?? config.model.testlet_size,
      );
      const stopping = timeline_config.stopping ?? config.stopping ?? config.model.stopping ?? null;
      const controller_mode = normalizeControllerMode(
        timeline_config.controller ?? config.controller,
      );
      const design_strategy = timeline_config.design_strategy ?? config.design_strategy ?? "ado";
      const effective_design_strategy = controller_mode === "mock" ? null : design_strategy;
      const debug = resolveDebug(timeline_config.debug ?? config.debug ?? "url");
      const response_labels = inferResponseLabels(
        response_trial,
        adapter.responseSpace,
        timeline_config.response_labels ?? config.response_labels,
      );
      validateResponseLabels(response_labels, adapter.responseSpace);
      const stan = {
        ...DEFAULT_STAN,
        ...config.model.stan,
        ...config.stan,
        ...timeline_config.stan,
      };
      const simulate = timeline_config.simulate ?? config.simulate ?? null;

      const adaptive_controller =
        controller_mode === "mock"
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
        ado_mode:
          controller_mode === "mock"
            ? "mock"
            : effective_design_strategy === "random"
              ? "random"
              : "stan",
        controller_mode,
        design_strategy: effective_design_strategy,
        model_id: adapter.id,
        posterior_display: config.model.posterior_display,
      };
      if (simulate) {
        run_context.simulation_mode = simulate.mode ?? "data-only";
        run_context.simulate_choice = makeSimulatedParticipant(adapter, simulate);
      }

      // Per-run response-recording state. recording_open gates recordResponse to
      // the composed on_finish; a validated response lands on data.__ado_response
      // for the timeline's finalize step.
      let recording_open = false;
      let response_recorded = false;
      let recorded_response;
      let get_live_design = null;
      let get_live_state = null;

      const run = {
        getDesign: () => (get_live_design ? get_live_design() : null),
        getState: () => (get_live_state ? get_live_state() : null),
        recordResponse(response) {
          if (!recording_open) {
            throw new Error(
              "recordResponse: call this from the adaptive trial's on_finish callback.",
            );
          }
          if (response_recorded) {
            throw new Error(
              "recordResponse: only one response can be recorded per adaptive trial.",
            );
          }
          validateRecordedResponse(response, adapter.responseSpace);
          recorded_response = response;
          response_recorded = true;
        },
      };
      // Make the handle usable for the run being built (design reads in dynamic
      // parameters resolve against the most recently created timeline until another
      // run activates itself at timeline start).
      active_run = run;

      const timeline = createAdoTimeline(
        jsPsych,
        adaptive_controller,
        {
          n_trials,
          testlet_size,
          stopping,
          response_labels,
          choices: response_trial ? response_trial.choices : undefined,
          describeDesign: timeline_config.describeDesign ?? config.describeDesign,
          getChoiceTrials(ctx) {
            get_live_design = ctx.getDesign;
            get_live_state = ctx.getState;
            const materialized = uses_trial_factory
              ? trial_or_trials({ ...ctx, ado })
              : static_trial_info.trials;
            const { trials, response_trial_index } = normalizeControllerTrials(
              materialized,
              timeline_config.response_trial_index,
            );
            return trials.map((trial, index) => {
              const cloned = { ...trial };
              delete cloned.__ado_is_response;
              if (index !== response_trial_index) {
                return cloned;
              }

              const inner_on_finish = cloned.on_finish;
              cloned.on_finish = async function (data) {
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
                  throw new Error(
                    "ADO trial finished without calling ado.recordResponse(...). " +
                      "Record the model outcome from the trial's on_finish.",
                  );
                }
                data.__ado_response = recorded_response;
              };
              // Simulation hook (#135 follow-up to the old ?simulate= contract): when a
              // synthetic participant is configured, supply plugin simulation data drawn
              // from the model likelihood at the live design. User-authored
              // simulation_options win.
              if (run_context.simulate_choice && cloned.simulation_options === undefined) {
                cloned.simulation_options = () =>
                  makeChoiceSimulationOptions(run_context, ctx.getDesign());
              }
              cloned.__ado_is_response = true;
              return cloned;
            });
          },
        },
        run_context,
        {
          onTimelineStart: () => {
            active_run = run;
          },
        },
      );

      return timeline;
    },
  };

  return ado;
}

// ---------------------------------------------------------------------------
// prepareModel (compile-from-source prototyping path)
// ---------------------------------------------------------------------------

/**
 * Turn a source model spec ({ stanCode | stanUrl, params, designKeys, responseSpace,
 * likelihood, stanData, ... }) into a model package usable with createController, by
 * compiling the Stan source to WASM on a compile server and (when needed) deriving
 * the JS prior from the source. Models that already carry a moduleUrl pass through.
 *
 * Run once at study setup (not per participant). Compiled module URLs are cached
 * by server + source within the page session.
 *
 * @param {Object} spec - Model spec with exactly one of stanCode | stanUrl | moduleUrl.
 * @param {Object} opts
 * @param {string} opts.compileServer - Base URL of a Stan-to-WASM compile server.
 * @param {string} [opts.authToken] - Bearer token for the compile endpoint.
 * @returns {Promise<Object>} A model package with moduleUrl and prior filled in.
 */
async function prepareModel(spec, { compileServer, authToken = DEFAULT_TOKEN } = {}) {
  if (!spec || typeof spec !== "object") {
    throw new Error("prepareModel: spec must be an object.");
  }
  const sources = ["stanCode", "stanUrl", "moduleUrl"].filter((k) => spec[k] != null);
  if (sources.length !== 1) {
    throw new Error(
      `prepareModel: provide exactly one of stanCode | stanUrl | moduleUrl (got ${sources.length}).`,
    );
  }
  if (spec.moduleUrl) {
    return spec;
  }
  if (!compileServer) {
    throw new Error(
      "prepareModel: the model needs compilation, but no compileServer was provided.",
    );
  }

  let stanCode = spec.stanCode;
  if (!stanCode && spec.stanUrl) {
    const res = await fetch(spec.stanUrl);
    if (!res.ok) {
      throw new Error(`prepareModel: could not fetch stanUrl (${res.status}).`);
    }
    stanCode = await res.text();
  }

  const prior = spec.prior ?? parseStanPriors(stanCode, spec.params);

  // Key the cache by server AND source so the same .stan compiled against a
  // different server doesn't return the first server's stale module URL. (#10)
  const cacheKey = `${(compileServer || "").replace(/\/+$/, "")}\n${stanCode}`;
  let moduleUrl = _compileCache.get(cacheKey);
  if (!moduleUrl) {
    moduleUrl = await compileToModuleUrl(stanCode, compileServer, authToken);
    _compileCache.set(cacheKey, moduleUrl);
  }

  const { stanCode: _code, stanUrl: _url, ...rest } = spec;
  return { ...rest, prior, moduleUrl };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

// Validate the model package and adapt it to the engine's controller shape
// (mirrors the old registry's buildAdapter, but from a model object directly).
function buildModelAdapter(model, context) {
  const { valid, problems } = validateModel(model);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    throw new Error(
      `${context}("${model && model.id ? model.id : "<model>"}"): invalid model package:\n  - ` +
        errors.map((e) => e.message).join("\n  - "),
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
      ? (trials) =>
          toStanData(trials.map(({ choice, ...design }) => ({ design, response: choice })))
      : makeStanDataBuilder({ stanData, responseSpace: model.responseSpace });

  return {
    id: model.id,
    params: model.params,
    prior: model.prior,
    moduleUrl: model.moduleUrl,
    wasmUrl: model.wasmUrl ?? null, // forwarded to the worker's locateFile (#57)
    designKeys: model.designKeys,
    responseSpace: model.responseSpace,
    buildData: adaptedBuildData,
    responseProb,
    responseProbs:
      responseProbs ||
      (typeof responseProb === "function"
        ? (design, draw) => {
            const p = responseProb(design, draw);
            return [1 - p, p];
          }
        : null),
    // Continuous-response adapter fields (undefined for discrete models). The
    // engine's createDesignScorer reads these when responseSpace.type === "continuous".
    responseDensity: model.responseDensity,
    responseDensityFactory: model.responseDensityFactory,
    conditionalEntropy: model.conditionalEntropy,
    responseMoments: model.responseMoments,
    responseSupport: model.responseSupport,
    responseSampler: model.responseSampler,
  };
}

function validateRecordedResponse(response, responseSpace) {
  if (isContinuous(responseSpace)) {
    if (typeof response !== "number" || !Number.isFinite(response)) {
      throw new Error(
        `recordResponse: continuous models need a finite numeric response; got ${JSON.stringify(response)}. ` +
          "Map the plugin's raw response before recording (e.g. Number(data.response)).",
      );
    }
    return;
  }
  const count = getResponseCount(responseSpace);
  if (!Number.isInteger(response) || response < 0 || (count != null && response >= count)) {
    throw new Error(
      `recordResponse: expected an integer outcome in 0..${count != null ? count - 1 : "K-1"}; ` +
        `got ${JSON.stringify(response)}. Map the plugin's raw response (button index, key) to the ` +
        "model's outcome coding in on_finish before calling recordResponse.",
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

  // The response trial defaults to the LAST trial of the step (fixation ->
  // stimulus -> response is the common shape); response_trial_index overrides.
  let index = response_trial_index;
  if (index == null) {
    index = trials.length - 1;
  }
  if (!Number.isInteger(index) || index < 0 || index >= trials.length) {
    throw new Error(
      `ado.createTimeline: response_trial_index must be between 0 and ${trials.length - 1}.`,
    );
  }
  return { trials, response_trial_index: index };
}

function inferResponseLabels(response_trial, responseSpace, explicit_labels) {
  if (isContinuous(responseSpace)) {
    return explicit_labels != null ? labelsToConfig(explicit_labels) : null;
  }
  if (explicit_labels != null) {
    return labelsToConfig(explicit_labels);
  }
  if (response_trial && Array.isArray(response_trial.choices)) {
    return labelsToConfig(response_trial.choices);
  }
  const response_count = getResponseCount(responseSpace);
  if (response_count != null) {
    return Object.fromEntries(
      Array.from({ length: response_count }, (_value, index) => [index, String(index)]),
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
    throw new Error(
      `ado.createTimeline: response_labels has ${label_count} entries; expected ${response_count}.`,
    );
  }
}

// Convert ["SS","LL"] -> {0:"SS",1:"LL"}; pass an object through unchanged.
function labelsToConfig(labels) {
  if (Array.isArray(labels)) {
    return Object.fromEntries(labels.map((label, index) => [index, label]));
  }
  return labels;
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

// Build the simulate_choice hook for a synthetic participant: draw a response from
// the model likelihood at the live design (same seam the recovery tooling uses).
function makeSimulatedParticipant(adapter, simulate) {
  const participant = simulate.participant;
  if (!participant || typeof participant !== "object") {
    throw new Error(
      "createTimeline: simulate.participant must map each model parameter to a value.",
    );
  }
  for (const param of adapter.params) {
    if (typeof participant[param] !== "number") {
      throw new Error(`createTimeline: simulate.participant is missing parameter "${param}".`);
    }
  }
  const rng = createSeededRng(simulate.seed ?? 8675309);
  const simulation_config = {
    params: participant,
    rt: { choice: simulate.rt_ms ?? (simulate.rt && simulate.rt.choice) ?? 500 },
  };
  return (design) => {
    const sim = isContinuous(adapter.responseSpace)
      ? simulateContinuousResponse(design, simulation_config, rng, adapter)
      : simulateCategoricalChoice(design, simulation_config, rng, adapter);
    return typeof simulate.respond === "function" ? simulate.respond(design, sim) : sim;
  };
}

const jsPsychADO = {
  createController,
  prepareModel,
  validateModel,
  // Design-grid axis helpers (see ado/grid.js).
  arange,
  linspace,
  // Stan data-block builder (see ado/stan_data.js).
  makeStanDataBuilder,
};

export {
  jsPsychADO,
  createController,
  prepareModel,
  validateModel,
  arange,
  linspace,
  makeStanDataBuilder,
  // Advanced / internal — exported for power users and the test suite, NOT part of the
  // stable jsPsychADO façade; may change without a major version bump while pre-1.0.
  parseStanPriors,
  labelsToConfig,
  buildModelAdapter,
};
export default jsPsychADO;
