/**
 * Return a deterministic local design with the same shape as the ADO API.
 *
 * @param {Object} config - Delay-discounting config with grid_design.
 * @param {number} trial_index - Zero-based trial index.
 * @returns {Object} Delay-discounting design with t_ss, t_ll, r_ss, r_ll.
 */
function makeMockDesign(config, trial_index) {
  const delays = config.grid_design.t_ll;
  const rewards = config.grid_design.r_ss;
  return {
    t_ss: 0,
    t_ll: delays[trial_index % delays.length],
    r_ss: rewards[(trial_index * 7) % rewards.length],
    r_ll: 800,
  };
}

function nowMs() {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

function makeMockMaxMutualInfo(design, trial_index) {
  const reward_gap = Math.max(0, design.r_ll - design.r_ss) / design.r_ll;
  const delay_weight = Math.log1p(design.t_ll) / Math.log1p(520);
  const trial_weight = 1 / (1 + trial_index * 0.02);
  return 0.01 + 0.04 * reward_gap * delay_weight * trial_weight;
}

function estimateMockSelectionTime(config, trial_index) {
  let samples = 64;
  while (samples <= 16384) {
    const started_at = nowMs();
    for (let i = 0; i < samples; i++) {
      makeMockDesign(config, trial_index);
    }
    const elapsed_ms = nowMs() - started_at;
    if (elapsed_ms > 0) {
      return elapsed_ms / samples;
    }
    samples *= 2;
  }
  return 0;
}

function selectMockDesign(config, trial_index) {
  const started_at = nowMs();
  const next_design = makeMockDesign(config, trial_index);
  const elapsed_ms = nowMs() - started_at;
  const eig = makeMockMaxMutualInfo(next_design, trial_index);
  return {
    next_design,
    selection_time_ms: elapsed_ms || estimateMockSelectionTime(config, trial_index),
    eig,
    max_mutual_info: eig,
  };
}

function normalizeMockStopping(config) {
  const stopping = config.stopping || {};
  const max_trials = Number.isFinite(Number(stopping.max_trials))
    ? Math.max(0, Math.floor(Number(stopping.max_trials)))
    : Math.max(0, Math.floor(Number(config.n_trials || 0)));
  return {
    min_trials: Number.isFinite(Number(stopping.min_trials))
      ? Math.max(0, Math.floor(Number(stopping.min_trials)))
      : 0,
    max_trials,
    eig_tolerance: Number.isFinite(Number(stopping.eig_tolerance))
      ? Math.max(0, Number(stopping.eig_tolerance))
      : null,
  };
}

/**
 * Return deterministic posterior-like summaries for mock runs.
 *
 * @param {number} trial_index - Zero-based trial index.
 * @returns {Object} Object with post_mean and post_sd k/tau summaries.
 */
function makeMockPosterior(trial_index) {
  return {
    post_mean: {
      k: 0.05 + trial_index * 0.002,
      tau: 1.0 + trial_index * 0.01,
    },
    post_sd: {
      k: Math.max(0.001, 0.05 - trial_index * 0.001),
      tau: Math.max(0.01, 0.8 - trial_index * 0.01),
    }
  };
}

function makeMockPosteriorDraws(post_mean, post_sd, trial_index, n = 160) {
  const draws = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * (i + 1)) / n;
    const k_wave = 0.75 * Math.sin(angle * 2 + trial_index) + 0.35 * Math.cos(angle * 5);
    const tau_wave = 0.75 * Math.cos(angle * 2 + trial_index / 2) + 0.35 * Math.sin(angle * 3);
    draws.push({
      k: Math.max(1e-9, post_mean.k + post_sd.k * k_wave),
      tau: Math.max(1e-9, post_mean.tau + post_sd.tau * tau_wave),
    });
  }
  return draws;
}

/**
 * Create a local controller that satisfies the ADO controller contract without
 * loading WASM. It is for timeline development and manual browser smoke tests.
 *
 * @param {Object} config - Delay-discounting config with grid_design.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createMockAdoController(config) {
  let session_id = "mock-session";
  let trial_index = 0;
  let latest_state = null;
  const stopping = normalizeMockStopping(config);

  function withMockStoppingState(state, selection) {
    const hit_max_trials = state.trial_index >= stopping.max_trials;
    latest_state = {
      ...state,
      eig: selection.eig,
      max_mutual_info: selection.max_mutual_info,
      should_stop: hit_max_trials,
      stop_reason: hit_max_trials ? "max_trials" : null,
      stopping,
    };
    return latest_state;
  }

  return {
    /**
     * Start a mock ADO session and return the first deterministic design.
     *
     * @param {Object} context - Run context; session_id is used if present.
     * @returns {Promise<Object>} ADO state with next_design and null posterior summaries.
     */
    start: async function(context) {
      session_id = context.session_id || "mock-session";
      trial_index = 0;
      const selection = selectMockDesign(config, trial_index);
      return withMockStoppingState({
        session_id,
        trial_index,
        next_design: selection.next_design,
        post_mean: null,
        post_sd: null,
        posterior_draws: null,
        realized_information_gain: null,
        selection_time_ms: selection.selection_time_ms,
        api_latency_ms: null,
      }, selection);
    },

    /**
     * Advance the mock controller after one completed jsPsych choice row.
     *
     * @param {Object} trial_data - Choice row with ado_trial_index.
     * @returns {Promise<Object>} Updated mock ADO state.
     */
    update: async function(trial_data) {
      trial_index = trial_data.ado_trial_index + 1;
      const posterior = makeMockPosterior(trial_index);
      const selection = selectMockDesign(config, trial_index);
      return withMockStoppingState({
        session_id,
        trial_index,
        next_design: selection.next_design,
        post_mean: posterior.post_mean,
        post_sd: posterior.post_sd,
        posterior_draws: makeMockPosteriorDraws(posterior.post_mean, posterior.post_sd, trial_index),
        realized_information_gain: null,
        selection_time_ms: selection.selection_time_ms,
        api_latency_ms: null,
      }, selection);
    },

    getState: function() {
      return latest_state;
    },
  };
}

export { createMockAdoController };
