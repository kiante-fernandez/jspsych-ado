import {
  enumerateDesigns,
  getResponseProbsFunction,
  selectOptimalDesigns,
  summarizeDraws,
  samplePriorDraws,
} from "../ado/mi_engine.js";
import { createSeededRng } from "../ado/ado_simulation.js";

// Number of prior draws used to pick the first design (before any data exist).
const PRIOR_DRAWS = 2000;

/**
 * Create a fully in-browser, model-agnostic adaptive controller.
 *
 * It satisfies the same contract as the mock/API controllers (start/update
 * returning the next design/testlet, posterior summaries, and optional
 * design-selection diagnostics), but does
 * the work locally: Stan (via a Web Worker + WASM) infers the posterior over the
 * model parameters from the accumulated choices, and the generic MI engine picks
 * the next design. No Python, no network.
 *
 * @param {Object} options
 * @param {Object} options.model - Model adapter (params, prior, moduleUrl, buildData, responseProb/responseProbs).
 * @param {Object} options.grid_design - Candidate design grid for MI optimization.
 * @param {Object} [options.stan] - Sampler settings {num_chains, num_warmup, num_samples, seed}.
 * @param {string} [options.session_id] - Session identifier saved into the data.
 * @param {number} [options.n_trials] - Total choice trials; lets the final update skip
 *   the unused next-design search. Omit to always compute a next design.
 * @param {string} [options.design_strategy="ado"] - "ado" for MI-selected
 *   designs, "random" for a recovery/dev baseline sampled from the same grid.
 * @param {?number} [options.design_seed] - Optional seed for prior/random design
 *   selection. Defaults to stan.seed so existing runs stay reproducible.
 * @param {number} [options.testlet_size=1] - Choice trials shown between Stan refits.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 *   Results include next_designs plus aligned next_design_metrics, where
 *   mutual_info is available for MI-selected ADO designs and null for random.
 */
function createStanAdoController({
  model,
  grid_design,
  stan = {},
  session_id = "stan-session",
  n_trials = null,
  design_strategy = "ado",
  design_seed = null,
  testlet_size = 1,
}) {
  const sample_config = {
    num_chains: stan.num_chains ?? 2,
    num_warmup: stan.num_warmup ?? 500,
    num_samples: stan.num_samples ?? 500,
    seed: stan.seed ?? 123,
  };

  if (sample_config.num_chains < 1 || sample_config.num_warmup < 0 || sample_config.num_samples < 1) {
    throw new Error("createStanAdoController: stan settings need num_chains>=1, num_warmup>=0, num_samples>=1");
  }
  if (!["ado", "random"].includes(design_strategy)) {
    throw new Error(`createStanAdoController: unknown design_strategy "${design_strategy}"`);
  }
  if (!Number.isInteger(testlet_size) || testlet_size < 1) {
    throw new Error("createStanAdoController: testlet_size must be a positive integer");
  }

  // The candidate design grid is constant, so enumerate it once. An empty grid
  // (a dimension with no values) would make every design selection return null.
  const designs = enumerateDesigns(grid_design);
  const responseProbs = getResponseProbsFunction(model);
  if (designs.length === 0) {
    throw new Error("createStanAdoController: grid_design produced no candidate designs (a dimension is empty)");
  }
  if (testlet_size > designs.length) {
    throw new Error("createStanAdoController: testlet_size cannot exceed the number of candidate designs");
  }

  const trials = [];
  const design_rng = createSeededRng(design_seed ?? sample_config.seed);

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

  /**
   * Draw one candidate design from the enumerated grid with replacement.
   *
   * This is used only for the recovery/dev baseline. It keeps the inference
   * path identical to the MI controller, while replacing the design policy.
   */
  function sampleRandomDesign() {
    const index = Math.floor(design_rng() * designs.length);
    return designs[index];
  }

  function sampleRandomDesigns(count) {
    const next_designs = [];
    for (let i = 0; i < count; i++) {
      next_designs.push(sampleRandomDesign());
    }
    return next_designs;
  }

  function nullDesignMetrics(count) {
    const metrics = [];
    for (let i = 0; i < count; i++) {
      metrics.push({ mutual_info: null });
    }
    return metrics;
  }

  function maxMutualInfo(metrics) {
    let max_mi = null;
    for (const metric of metrics) {
      const mi = metric && metric.mutual_info;
      if (typeof mi === "number" && Number.isFinite(mi)) {
        max_mi = max_mi == null ? mi : Math.max(max_mi, mi);
      }
    }
    return max_mi;
  }

  /**
   * Select the next design under the configured policy.
   *
   * The "random" policy intentionally ignores posterior draws for design
   * selection but still receives them so this helper has one call shape.
   */
  function selectDesignsWithMetrics(draws, count) {
    if (count <= 0) {
      return {
        next_designs: [],
        next_design_metrics: [],
        selection_time_ms: null,
        max_mutual_info: null,
      };
    }
    const selection_started_at = now();
    let next_designs = [];
    let next_design_metrics = [];
    if (design_strategy === "random") {
      next_designs = sampleRandomDesigns(count);
      next_design_metrics = nullDesignMetrics(next_designs.length);
    } else {
      const picks = selectOptimalDesigns(designs, draws, responseProbs, count, { rng: design_rng });
      next_designs = picks.map((pick) => pick.design);
      next_design_metrics = picks.map((pick) => ({ mutual_info: pick.mutual_info }));
    }

    return {
      next_designs,
      next_design_metrics,
      selection_time_ms: now() - selection_started_at,
      max_mutual_info: maxMutualInfo(next_design_metrics),
    };
  }

  function nextBlockSize(from_index) {
    const remaining = n_trials == null ? testlet_size : Math.max(0, n_trials - from_index);
    return Math.min(testlet_size, remaining);
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

      const block_size = nextBlockSize(trials.length);
      let selection = selectDesignsWithMetrics([], 0);
      if (design_strategy === "random") {
        selection = selectDesignsWithMetrics([], block_size);
      } else {
        const prior = samplePriorDraws(model.prior, PRIOR_DRAWS, design_rng);
        selection = selectDesignsWithMetrics(prior, block_size);
      }

      return {
        session_id,
        trial_index: trials.length,
        next_design: selection.next_designs[0] ?? null,
        next_designs: selection.next_designs,
        next_design_metrics: selection.next_design_metrics,
        selection_time_ms: selection.selection_time_ms,
        max_mutual_info: selection.max_mutual_info,
        post_mean: null,
        post_sd: null,
        api_latency_ms: null,
      };
    },

    /**
     * Add the latest choice/testlet, re-infer the posterior with Stan, and pick
     * the next MI-optimal design/testlet.
     *
     * @param {Object|Array<Object>} trial_data - jsPsych choice row(s) with ado_design and choice.
     * @returns {Promise<Object>} Updated ADO state with posterior summaries.
     */
    update: async function(trial_data) {
      const started_at = now();

      const rows = Array.isArray(trial_data) ? trial_data : [trial_data];
      for (const row of rows) {
        trials.push({ ...row.ado_design, choice: row.choice });
      }

      const draws = await samplePosterior();
      const { post_mean, post_sd } = summarizeDraws(draws, model.params);

      // The design produced after the final choice is never shown, so skip the
      // ~1M-evaluation MI scan on the last update.
      const block_size = nextBlockSize(trials.length);
      const selection = selectDesignsWithMetrics(draws, block_size);

      return {
        session_id,
        trial_index: trials.length,
        next_design: selection.next_designs[0] ?? null,
        next_designs: selection.next_designs,
        next_design_metrics: selection.next_design_metrics,
        selection_time_ms: selection.selection_time_ms,
        max_mutual_info: selection.max_mutual_info,
        post_mean,
        post_sd,
        // Reuse the latency field to report local sampling+MI time (ms).
        api_latency_ms: Math.round(now() - started_at),
      };
    },
  };
}

export { createStanAdoController };
