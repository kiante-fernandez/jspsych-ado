/**
 * Magnitude-estimation (Stevens power law) run configuration.
 *
 * Task-owned pieces (the magnitude design grid, the canvas-slider presentation, and
 * the response coding that logs the slider estimate) live in
 * src/tasks/magnitude_estimation/task.js. This file holds controller and run
 * settings for the experiment page.
 */
const default_magnitude_estimation_config = {
  n_trials: 20,
  testlet_size: 1,
  stan: {
    num_chains: 2,
    num_warmup: 500,
    num_samples: 500,
    seed: 123,
  },
};

/**
 * Editable simulated-participant settings used only by jsPsych.simulate(). The values
 * are the data-generating Stevens parameters in log-log space: loga (log scale),
 * b (the perceptual exponent), sigma (log-scale estimation noise) — not posterior estimates.
 */
const default_magnitude_estimation_simulation_config = {
  seed: 123,
  params: {
    loga: -1.5,
    b: 0.7,
    sigma: 0.25,
  },
  rt: {
    instructions: 300,
    choice: 600,
    end: 300,
  },
};

export { default_magnitude_estimation_config, default_magnitude_estimation_simulation_config };
