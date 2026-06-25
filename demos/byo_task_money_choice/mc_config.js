/**
 * Run configuration for the "bring your own task" demo.
 *
 * The TASK is authored from scratch in task.js (this folder); the MODEL is the
 * packaged hyperbolic model. This file only holds controller/run settings.
 */
const default_mc_config = {
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
 * the data-generating hyperbolic k/tau.
 */
const default_mc_simulation_config = {
  seed: 123,
  params: {
    k: 0.01,
    tau: 2.5,
  },
  rt: {
    instructions: 300,
    choice: 500,
    end: 300,
  },
};

export { default_mc_config, default_mc_simulation_config };
