/**
 * Halberda dot-comparison run configuration.
 *
 * Task-owned pieces such as the numerosity-pair design list, canvas
 * presentation, key mapping, and correct/incorrect response coding live in
 * jspsych-ado/tasks/halberda_dot_comparison/task.js. This file holds controller
 * and run settings for the experiment page.
 */
const default_halberda_config = {
  n_trials: 40,
  testlet_size: 1,
  stan: {
    num_chains: 2,
    num_warmup: 500,
    num_samples: 500,
    seed: 123,
  },
  quest_plus: {
    parameter_samples: {
      w: [0.08, 0.12, 0.16, 0.20, 0.25, 0.32, 0.40, 0.55, 0.75],
    },
  },
};

/**
 * Editable simulated-participant settings used only by jsPsych.simulate().
 * The value of w is the data-generating Weber fraction, not a posterior estimate.
 */
const default_halberda_simulation_config = {
  seed: 123,
  params: {
    w: 0.25,
  },
  rt: {
    instructions: 300,
    choice: 500,
    end: 300,
  },
};

export {
  default_halberda_config,
  default_halberda_simulation_config,
};
