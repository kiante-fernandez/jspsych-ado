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
      return {
        session_id,
        trial_index,
        next_design: makeMockDesign(config, trial_index),
        post_mean: null,
        post_sd: null,
        api_latency_ms: null,
      };
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
      return {
        session_id,
        trial_index,
        next_design: makeMockDesign(config, trial_index),
        post_mean: posterior.post_mean,
        post_sd: posterior.post_sd,
        api_latency_ms: null,
      };
    }
  };
}

export { createMockAdoController };
