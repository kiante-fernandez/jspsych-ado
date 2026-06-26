/**
 * Run configuration for the "bring your own model" demo.
 *
 * This uses the SAME packaged delay-discounting task as demos/delay_discounting/,
 * but fits the exponential-discounting model instead of the hyperbolic one. The
 * only conceptual change is the model — see this folder's README for how that model
 * was authored. Task-owned pieces (grid, presentation, response coding) come from
 * src/tasks/delay_discounting/.
 */
const default_exp_config = {
  n_trials: 42,
  testlet_size: 1,
  stan: {
    num_chains: 2,
    num_warmup: 500,
    num_samples: 500,
    seed: 123,
  },
};

/**
 * Simulated-participant settings (only used under jsPsych.simulate()). params are
 * the data-generating exponential k/tau, in a range the design grid identifies.
 */
const default_exp_simulation_config = {
  seed: 123,
  params: {
    k: 0.05,
    tau: 3.0,
  },
  rt: {
    instructions: 300,
    choice: 500,
    end: 300,
  },
};

export { default_exp_config, default_exp_simulation_config };
