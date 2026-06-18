function range(start, stop, step) {
  let values = [];
  for (let value = start; value < stop; value += step) {
    values.push(Number(value.toFixed(10)));
  }
  return values;
}

/**
 * Delay-discounting task and ADO configuration.
 *
 * grid_design defines the candidate SS/LL designs the adaptive controller scores
 * by mutual information. stan holds the NUTS sampler settings used by the
 * in-browser Stan controller. The parameter prior now lives in the model adapter
 * (models/<name>/model.js), co-located with the priors in its .stan file.
 * stopping controls the dynamic trial loop. eig_tolerance is in nats; the
 * maximum EIG for a binary response is ln(2), about 0.693.
 * response_labels must match the jsPsych button indices used in the timeline:
 * 0 = SS, 1 = LL.
 */
const default_dd_config = {
  n_trials: 42,
  stopping: {
    min_trials: 8,
    max_trials: 42,
    eig_tolerance: 0.08,
  },
  grid_design: {
    t_ss: [0],
    t_ll: [
      0.43, 0.714, 1, 2, 3,
      4.3, 6.44, 8.6, 10.8, 12.9,
      17.2, 21.5, 26, 52, 104,
      156, 260, 520
    ],
    r_ss: range(12.5, 800, 12.5),
    r_ll: [800],
  },
  stan: {
    num_chains: 2,
    num_warmup: 500,
    num_samples: 500,
    seed: 123,
  },
  response_labels: {
    0: "SS",
    1: "LL",
  }
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
  }
};

export {
  default_dd_config,
  default_dd_simulation_config,
};
