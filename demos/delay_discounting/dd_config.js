/**
 * Delay-discounting run configuration.
 *
 * Task-owned pieces such as grid_design, presentation, choices, response labels,
 * and response coding live in src/tasks/delay_discounting/task.js. This
 * file holds controller/run settings for the experiment page.
 */
const default_dd_config = {
  n_trials: 42,
  testlet_size: 1,
  // Adaptive early stopping (#21) is off by default (fixed 42-trial run). To enable
  // it, add a `stopping` block — the loop then stops once the best next design's EIG
  // drops below eig_fraction * ln(K), bounded by min/max_trials:
  //   stopping: { eig_fraction: 0.1, min_trials: 8, max_trials: 42, consecutive: 1 },
  stan: {
    num_chains: 2,
    num_warmup: 500,
    num_samples: 500,
    seed: 123,
  },
};

/**
 * Editable simulated-participant settings used only when jsPsych.simulate()
 * is active. params are the data-generating k/tau values; they are not posterior
 * estimates. rt controls deterministic simulated response times.
 */
const default_dd_simulation_config = {
  seed: 123,
  params: {
    k: 0.001,
    tau: 2.5,
  },
  rt: {
    instructions: 300,
    choice: 500,
    end: 300,
  },
};

export { default_dd_config, default_dd_simulation_config };
