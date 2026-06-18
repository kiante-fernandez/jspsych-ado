import {
  enumerateDesigns,
  realizedInformationGain,
  selectOptimalDesign,
  summarizeDraws,
  samplePriorDraws,
} from "../ado/mi_engine.js";
import { createSeededRng } from "../dd_simulation.js";

// Number of prior draws used to pick the first design (before any data exist).
const PRIOR_DRAWS = 2000;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNonNegativeInteger(value, fallback = null) {
  const number = toFiniteNumber(value);
  if (number === null || number < 0) {
    return fallback;
  }
  return Math.floor(number);
}

function toNonNegativeNumber(value, fallback = null) {
  const number = toFiniteNumber(value);
  if (number === null || number < 0) {
    return fallback;
  }
  return number;
}

function normalizeStoppingConfig(stopping = {}, legacy_max_trials = null) {
  const source = stopping || {};
  const max_trials = toNonNegativeInteger(
    source.max_trials,
    toNonNegativeInteger(legacy_max_trials, null),
  );

  return {
    min_trials: toNonNegativeInteger(source.min_trials, 0),
    max_trials,
    eig_tolerance: toNonNegativeNumber(source.eig_tolerance, null),
  };
}

function evaluateStoppingState({ completed_trials, eig, stopping }) {
  const completed = toNonNegativeInteger(completed_trials, 0);
  const current_eig = toFiniteNumber(eig);
  const config = normalizeStoppingConfig(stopping);

  if (config.max_trials !== null && completed >= config.max_trials) {
    return {
      should_stop: true,
      stop_reason: "max_trials",
      completed_trials: completed,
      eig: current_eig,
      stopping: config,
    };
  }

  if (
    config.eig_tolerance !== null &&
    completed >= config.min_trials &&
    current_eig !== null &&
    current_eig < config.eig_tolerance
  ) {
    return {
      should_stop: true,
      stop_reason: "eig_tolerance",
      completed_trials: completed,
      eig: current_eig,
      stopping: config,
    };
  }

  return {
    should_stop: false,
    stop_reason: null,
    completed_trials: completed,
    eig: current_eig,
    stopping: config,
  };
}

/**
 * Create a fully in-browser, model-agnostic adaptive controller.
 *
 * It satisfies the same contract as the mock/API controllers (start/update
 * returning {session_id, trial_index, next_design, eig, should_stop, post_mean,
 * post_sd}), but does the work locally: Stan (via a Web Worker + WASM) infers
 * the posterior over the model parameters from the accumulated choices, and the
 * generic MI engine picks the next design. No Python, no network.
 *
 * @param {Object} options
 * @param {Object} options.model - Model adapter (params, prior, moduleUrl, buildData, choiceProbLL).
 * @param {Object} options.grid_design - Candidate design grid for MI optimization.
 * @param {Object} [options.stan] - Sampler settings {num_chains, num_warmup, num_samples, seed}.
 * @param {Object} [options.stopping] - Generic stopping settings {min_trials, max_trials, eig_tolerance}.
 * @param {string} [options.session_id] - Session identifier saved into the data.
 * @param {number} [options.n_trials] - Legacy hard cap, used only when stopping.max_trials is absent.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createStanAdoController({
  model,
  grid_design,
  stan = {},
  stopping = {},
  session_id = "stan-session",
  n_trials = null,
}) {
  const sample_config = {
    num_chains: stan.num_chains ?? 2,
    num_warmup: stan.num_warmup ?? 500,
    num_samples: stan.num_samples ?? 500,
    seed: stan.seed ?? 123,
  };
  const stopping_config = normalizeStoppingConfig(stopping, n_trials);

  if (sample_config.num_chains < 1 || sample_config.num_warmup < 0 || sample_config.num_samples < 1) {
    throw new Error("createStanAdoController: stan settings need num_chains>=1, num_warmup>=0, num_samples>=1");
  }

  // The candidate design grid is constant, so enumerate it once. An empty grid
  // (a dimension with no values) would make every design selection return null.
  const designs = enumerateDesigns(grid_design);
  if (designs.length === 0) {
    throw new Error("createStanAdoController: grid_design produced no candidate designs (a dimension is empty)");
  }

  const trials = [];
  const rng = createSeededRng(sample_config.seed);
  let current_design_draws = null;
  let latest_state = null;

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
    worker.onmessage = function(event) {
      const message = event.data;
      settlePending(p => (message.type === "error" ? p.reject(new Error(message.error)) : p.resolve(message)));
    };
    // Worker-script-level failures (bad module path / 404 / parse error in the
    // worker or its imports) fire onerror and never post a message, so the pending
    // request would otherwise hang forever. Drop the dead worker so a later call
    // rebuilds it, and reject the in-flight request with a clear error.
    worker.onerror = function(event) {
      worker = null;
      settlePending(p => p.reject(new Error("Stan worker failed to load: " + (event.message || "worker error"))));
    };
    worker.onmessageerror = function() {
      worker = null;
      settlePending(p => p.reject(new Error("Stan worker message could not be deserialized")));
    };
  }

  function send(message) {
    // Requests are strictly sequential; a concurrent send would clobber the single
    // pending slot and orphan the first promise, so fail loudly instead.
    if (pending) {
      return Promise.reject(new Error("Stan controller received a request while one was already in flight"));
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(message);
    });
  }

  function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  function selectDesignWithMetrics(draws) {
    const started_at = now();
    const { design, mutual_info } = selectOptimalDesign(designs, draws, model.choiceProbLL);
    return {
      design,
      selection_time_ms: now() - started_at,
      eig: mutual_info,
      max_mutual_info: mutual_info,
    };
  }

  function withStoppingState(state, selection) {
    const stopping_state = evaluateStoppingState({
      completed_trials: state.trial_index,
      eig: selection.eig,
      stopping: stopping_config,
    });

    latest_state = {
      ...state,
      eig: selection.eig,
      max_mutual_info: selection.max_mutual_info,
      should_stop: stopping_state.should_stop,
      stop_reason: stopping_state.stop_reason,
      stopping: stopping_state.stopping,
    };
    return latest_state;
  }

  /**
   * Sample the posterior given the accumulated trials and return draws as an
   * array of per-draw parameter objects (the shape the MI engine expects).
   */
  async function samplePosterior() {
    const result = await send({
      type: "sample",
      data: model.buildData(trials),
      params: model.params,
      sampleConfig: sample_config,
    });
    const columns = result.draws;
    const n = columns[model.params[0]].length;
    if (n === 0) {
      throw new Error("Stan returned no posterior draws");
    }
    const draws = new Array(n);
    for (let s = 0; s < n; s++) {
      const draw = {};
      for (const param of model.params) {
        draw[param] = columns[param][s];
      }
      draws[s] = draw;
    }
    return draws;
  }

  return {
    /**
     * Load the WASM model and choose the first design from prior draws.
     *
     * @returns {Promise<Object>} Initial ADO state (null posteriors).
     */
    start: async function() {
      ensureWorker();
      await send({ type: "init", moduleUrl: model.moduleUrl });

      trials.length = 0;

      const prior = samplePriorDraws(model.prior, PRIOR_DRAWS, rng);
      current_design_draws = prior;
      const selection = selectDesignWithMetrics(prior);

      return withStoppingState({
        session_id,
        trial_index: trials.length,
        next_design: selection.design,
        post_mean: null,
        post_sd: null,
        posterior_draws: null,
        realized_information_gain: null,
        selection_time_ms: selection.selection_time_ms,
        api_latency_ms: null,
      }, selection);
    },

    /**
     * Add the latest choice, re-infer the posterior with Stan, and pick the next
     * MI-optimal design.
     *
     * @param {Object} trial_data - jsPsych choice row with ado_design and choice.
     * @returns {Promise<Object>} Updated ADO state with posterior summaries.
     */
    update: async function(trial_data) {
      const started_at = now();
      const realized_information_gain = current_design_draws
        ? realizedInformationGain(trial_data.ado_design, current_design_draws, trial_data.choice, model.choiceProbLL)
        : null;

      trials.push({ ...trial_data.ado_design, choice: trial_data.choice });

      const draws = await samplePosterior();
      const { post_mean, post_sd } = summarizeDraws(draws, model.params);

      const selection = selectDesignWithMetrics(draws);
      current_design_draws = draws;

      return withStoppingState({
        session_id,
        trial_index: trials.length,
        next_design: selection.design,
        post_mean,
        post_sd,
        posterior_draws: draws,
        realized_information_gain,
        selection_time_ms: selection.selection_time_ms,
        // Reuse the latency field to report local sampling+MI time (ms).
        api_latency_ms: now() - started_at,
      }, selection);
    },

    getState: function() {
      return latest_state;
    },
  };
}

export {
  createStanAdoController,
  evaluateStoppingState,
  normalizeStoppingConfig,
};
