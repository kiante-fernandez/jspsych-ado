/**
 * Create a controller that delegates ADO state updates to the Python API.
 *
 * Returned methods must match the timeline's controller contract:
 * start(context) resolves to the initial ADO state, and update(trial_data)
 * resolves to the next ADO state after one jsPsych choice row.
 *
 * @param {Object} config - Delay-discounting config sent to the backend.
 * @param {string} api_base - Base URL for the local ADO service.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createApiAdoController(config, api_base) {
  let session_id = null;

  /**
   * POST JSON to the ADO API and attach browser-measured latency.
   *
   * @param {string} path - API path, relative to api_base.
   * @param {Object} body - JSON request body.
   * @returns {Promise<Object>} Parsed ADO API response.
   */
  async function post(path, body) {
    const started_at = Date.now();
    const response = await fetch(`${api_base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const result = await response.json();
    result.api_latency_ms = Date.now() - started_at;
    return result;
  }

  return {
    /**
     * Start a backend ADO session and receive the first design.
     *
     * @param {Object} context - Run context saved with the backend session.
     * @returns {Promise<Object>} ADO state with session_id, trial_index, next_design, post_mean, post_sd.
     */
    start: async function(context) {
      const result = await post("/ado/sessions", {
        config,
        context,
      });
      session_id = result.session_id;
      return result;
    },

    /**
     * Submit one completed jsPsych choice row and receive the next ADO state.
     *
     * @param {Object} trial_data - Choice row with ado_design and choice fields.
     * @returns {Promise<Object>} Updated ADO state with posterior summaries and next_design.
     */
    update: async function(trial_data) {
      return await post(`/ado/sessions/${session_id}/update`, {
        trial_data,
        design: trial_data.ado_design,
        response: {
          choice: trial_data.choice,
        },
      });
    }
  };
}

export { createApiAdoController };
