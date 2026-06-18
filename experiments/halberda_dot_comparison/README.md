# Halberda-Style Dot Comparison ADO Task

This experiment is a jsPsych reproduction of the core non-verbal number acuity
task from:

Halberda, J., Mazzocco, M. M. M., & Feigenson, L. (2008). Individual differences
in non-verbal number acuity correlate with maths achievement. *Nature, 455*,
665-668.

Participants briefly see intermixed blue and yellow dots and answer which color
has more dots.

## Adaptive Structure

The runnable experiment now follows the same thin-consumer structure as
`experiments/delay_discounting`:

```text
experiments/experiment_halberda_dot_comparison/index.html
experiments/experiment_halberda_dot_comparison/halberda_config.js
jspsych-ado/tasks/halberda_dot_comparison/task.js
jspsych-ado/models/weber_dots/model.js
jspsych-ado/models/weber_dots/weber_dot_comparison.stan
```

The task package owns:

- the candidate numerosity pairs
- the blue/yellow canvas presentation
- the `B`/`Y` key mapping
- the mapping from raw color response to model outcome `0 = incorrect`,
  `1 = correct`

The model package owns:

- the Weber fraction parameter `w`
- the Stan data boundary for TinyStan
- the JS likelihood used by adaptive design selection
- the compiled `main.js`/`main.wasm` Stan artifacts

## How ADO Works Here

The task provides a list of possible stimuli, each with `n_blue` and `n_yellow`.
After each response, the Stan controller fits the Weber model to the completed
trial history, draws a posterior over `w`, scores the candidate stimulus list by
expected information gain, and selects the next dot comparison trial.

## Run Settings

Experiment-level settings live in `halberda_config.js`:

```js
const default_halberda_config = {
  n_trials: 40,
  testlet_size: 1,
  stan: {
    num_chains: 2,
    num_warmup: 500,
    num_samples: 500,
    seed: 123,
  },
};
```

Useful URL parameters:

```text
?controller=stan&strategy=ado
?controller=stan&strategy=random
?controller=mock
?controller=quest_plus
?simulate=data-only
?simulate=visual
?debug=1
```

## Legacy File

`experiment.js` is the older fixed-trial standalone version. The current
adaptive experiment is built from `index.html`, `halberda_config.js`, the task
package, and the Weber model package.
