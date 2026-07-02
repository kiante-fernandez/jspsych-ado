// Shared driver for adaptive timeline fragments in unit tests.
//
// Emulates jsPsych 8's trial lifecycle — the load-bearing ordering these
// regression tests depend on: function-valued parameters are resolved BEFORE
// on_start (processParameters -> onStart -> plugin -> await onFinish), and the
// composed async on_finish is awaited before the next trial runs.

/**
 * Drive a timeline fragment returned by ado.createTimeline()/createAdoTimeline().
 *
 * @param {Array} fragment - The one-node fragment ([{ timeline, on_timeline_start, ... }]).
 * @param {Function} [respond] - (step, trial, resolved) => plugin data row for the trial.
 * @returns {Promise<{rows: Array, rendered: Array}>} Data rows and the resolved
 *   parameter snapshots ({stimulus, choices, data, simulation_options}) per trial.
 */
async function runFragment(fragment, respond) {
  const root = fragment[0];
  if (root.on_timeline_start) root.on_timeline_start();
  const rows = [];
  const rendered = [];
  let step = 0;
  for (const node of root.timeline) {
    if (node.conditional_function && !node.conditional_function()) continue;
    for (const t of node.timeline) {
      const resolved = {};
      for (const key of ["stimulus", "choices", "data", "simulation_options"]) {
        resolved[key] = typeof t[key] === "function" ? t[key]() : t[key];
      }
      if (t.on_start) t.on_start(t);
      rendered.push(resolved);
      const data = respond ? respond(step, t, resolved) : { response: 1 };
      if (t.on_finish) await t.on_finish(data);
      rows.push(data);
      step += 1;
    }
  }
  if (root.on_timeline_finish) root.on_timeline_finish();
  return { rows, rendered };
}

export { runFragment };
