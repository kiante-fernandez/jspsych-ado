## Example: adaptive delay discounting

We illustrate the workflow with delay discounting, a widely used measure of
impulsive choice in which a participant repeatedly chooses between a
smaller-sooner (SS) and a larger-later (LL) reward (Mazur, 1987). A hyperbolic
model, `V = R / (1 + k·t)`, maps each offer to a subjective value, and a
logistic choice rule turns the value difference into the probability of choosing
LL. ADO presents the offer expected to be most informative about the discount
rate `k` and the choice-consistency parameter `τ`, so both are recovered in
fewer trials than a fixed offer schedule.

An experiment is a thin consumer of the library: it registers a _task_ (a design
grid plus a stimulus renderer) and a _model_ (a Stan likelihood plus a matching
JavaScript link function), then asks the façade for an adaptive timeline.

```js
import { jsPsychADO } from "./jspsych-ado/index.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";

const jsPsych = initJsPsych(); // jsPsych v8, initialised as usual

jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(hyperbolicModel, {
  stan: default_dd_config.stan, // sampler settings
  n_trials: default_dd_config.n_trials, // number of adaptive trials
});

const ado = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: hyperbolicModel.id,
  design_strategy: "ado", // "random" = same-grid baseline
});

jsPsych.run([/* instructions, */ ...ado /* , debrief */]);
```

The two registered pieces are all a researcher writes for a new experiment. A
task owns the candidate designs and their presentation; a model owns the
parameters, priors, and a link function that mirrors its Stan likelihood exactly
— the inference engine and the simulated participant call the same function.

```js
// Task package: where designs come from and how a trial looks.
const delayDiscountingTask = {
  id: "delay_discounting",
  design_grid: { t_ss: [0], t_ll: [1, 52], r_ss: [100, 400], r_ll: [800] },
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  presentation: { makeStimulus: renderOffer, keymap: { s: 0, l: 1 } },
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" },
};

// Model package: the JS link mirrors the Stan likelihood exactly.
// hyperbolic.stan:  y ~ bernoulli_logit(tau * (v_ll - v_ss));
function responseProb(design, { k, tau }) {
  const V = (r, t) => r / (1 + k * t); // V = R / (1 + k·t)
  return logistic(tau * (V(design.r_ll, design.t_ll) - V(design.r_ss, design.t_ss)));
}
```

`createTimeline` checks that the pair is compatible — the model's design keys
are present in the task grid and their response spaces match — before any
participant sees a trial. The hyperbolic model ships with its Stan program
precompiled to WebAssembly, so the experiment deploys as static files on JATOS
or GitHub Pages with no run-time compile step; alternatively, a model can be
registered from Stan source and compiled once at setup with
`await jsPsychADO.prepareModels({ compileServer })`. Setting
`design_strategy: "random"` draws from the same grid as a non-adaptive baseline,
and `debug` logs the per-trial design, posterior summary, and selection
diagnostics.
