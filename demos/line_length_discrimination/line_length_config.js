/**
 * 3IFC line-length discrimination run configuration.
 *
 * Task-owned pieces such as design_grid, presentation, choices, and response labels live
 * in src/tasks/line_length_discrimination/task.js. This file holds controller/run settings
 * for the experiment page.
 */
const default_line_length_config = {
  n_trials: 18,
  testlet_size: 1,
  stan: {
    num_chains: 2,
    num_warmup: 250,
    num_samples: 250,
    seed: 123,
  },
};

/**
 * Editable simulated-participant settings used only by jsPsych.simulate().
 *
 * These parameters feed the multinomial-logit responseProbs() function in the
 * 3IFC model package. They are data-generating values, not posterior estimates.
 */
const default_line_length_simulation_config = {
  seed: 123,
  params: {
    sensitivity: 2.2,
    bias_b: 0,
    bias_c: 0,
  },
  rt: {
    instructions: 300,
    choice: 500,
    end: 300,
  },
};

export { default_line_length_config, default_line_length_simulation_config };
