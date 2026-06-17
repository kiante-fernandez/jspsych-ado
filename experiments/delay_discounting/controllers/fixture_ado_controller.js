/**
 * Create a controller that replays saved ADO states from a fixture JSON file.
 *
 * The fixture must contain trials with next_design, post_mean, and post_sd
 * fields shaped like the live ADO API response.
 *
 * @param {string} fixture_path - Browser-fetchable path to fixture JSON.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createFixtureAdoController(fixture_path) {
  let fixture = null;
  let session_id = "fixture-session";
  let trial_index = 0;

  /**
   * Load and cache the fixture JSON.
   *
   * @returns {Promise<Object>} Parsed fixture data.
   */
  async function loadFixture() {
    if (fixture === null) {
      const response = await fetch(fixture_path);
      fixture = await response.json();
    }
    return fixture;
  }

  /**
   * Return one fixture trial state, cycling when the requested index is long.
   *
   * @param {Object} data - Parsed fixture data.
   * @param {number} index - Zero-based trial index.
   * @returns {Object} Fixture state with next_design, post_mean, and post_sd.
   */
  function getFixtureState(data, index) {
    const trials = data.trials || [];
    if (trials.length === 0) {
      throw new Error("Fixture has no trials.");
    }
    return trials[index % trials.length];
  }

  return {
    /**
     * Start fixture replay and return the first saved design.
     *
     * @param {Object} context - Run context; session_id is used if present.
     * @returns {Promise<Object>} ADO state shaped like the live API response.
     */
    start: async function(context) {
      const data = await loadFixture();
      session_id = context.session_id || data.session_id || "fixture-session";
      trial_index = 0;
      const state = getFixtureState(data, trial_index);
      return {
        session_id,
        trial_index,
        next_design: state.next_design,
        post_mean: state.post_mean || null,
        post_sd: state.post_sd || null,
        api_latency_ms: null,
      };
    },

    /**
     * Advance fixture replay after one completed jsPsych choice row.
     *
     * @param {Object} trial_data - Choice row with ado_trial_index.
     * @returns {Promise<Object>} Next fixture-backed ADO state.
     */
    update: async function(trial_data) {
      const data = await loadFixture();
      trial_index = trial_data.ado_trial_index + 1;
      const state = getFixtureState(data, trial_index);
      return {
        session_id,
        trial_index,
        next_design: state.next_design,
        post_mean: state.post_mean || null,
        post_sd: state.post_sd || null,
        api_latency_ms: null,
      };
    }
  };
}

export { createFixtureAdoController };
