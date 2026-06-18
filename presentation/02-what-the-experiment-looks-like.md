# jspsych-ado: Adaptive Design Optimization for jsPsych

> Run an experiment that picks the most informative question on every trial — with one import and one function call. No server and no Python: Stan runs in the participant's browser.

## Standard vs. adaptive

A standard jsPsych experiment repeats a fixed trial, so every participant sees the same questions. jspsych-ado keeps the exact same `jsPsych.run([...])` shape but replaces those repeated trials with an adaptive fragment that chooses each next question from everything answered so far.

```
Standard:     instructions → trial → trial → trial → end_screen     (identical each time)
jspsych-ado:  instructions → [ ADO fragment ] → end_screen          (design₁ optimal, design₂… updated)
```

You register a **task** (what a trial looks like, plus the grid of possible questions) and a **model** (a Stan likelihood plus a JS link function), then ask `jsPsychADO` for the timeline.

## 1. Built-in model

Delay discounting with the hyperbolic model ships ready to run:

```js
import { initJsPsych } from "jspsych";
import { jsPsychADO } from "./jspsych-ado/index.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";

const jsPsych = initJsPsych();

jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(hyperbolicModel);

const adoTrials = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: hyperbolicModel.id,
  n_trials: 20,
});

jsPsych.run([instructions, ...adoTrials, end_screen]);
```

The built-in model is precompiled, so the experiment is pure static files — host it anywhere (JATOS, GitHub Pages).

## 2. Custom model

To use your own cognitive model, register it from Stan source plus a matching JS link function, then compile once at setup with `prepareModels`. Everything else is identical. Here we keep the built-in delay-discounting task and swap in an **exponential** discounting model:

```js
import { initJsPsych } from "jspsych";
import { jsPsychADO } from "./jspsych-ado/index.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";

const jsPsych = initJsPsych();

// Stan source: data block + priors + likelihood. The priors are read from here.
const exponentialModel = `
  data {
    int<lower=1> N;
    vector[N] t_ss; vector[N] t_ll;
    vector[N] r_ss; vector[N] r_ll;
    array[N] int<lower=0, upper=1> y;          // 1 = chose larger-later
  }
  parameters { real<lower=0> k; real<lower=0> tau; }
  model {
    k   ~ lognormal(-2.0, 1.0);
    tau ~ lognormal(-1.0, 1.0);
    for (n in 1:N) {
      real v_ll = r_ll[n] * exp(-k * t_ll[n]);  // exponential, not hyperbolic
      real v_ss = r_ss[n] * exp(-k * t_ss[n]);
      y[n] ~ bernoulli_logit(tau * (v_ll - v_ss));
    }
  }
`;

// Link function: P(choose LL | design, params). Design comes first; mirror the Stan likelihood.
function responseProb(design, { k, tau }) {
  const v = (r, t) => r * Math.exp(-k * t);
  return 1 / (1 + Math.exp(-tau * (v(design.r_ll, design.t_ll) - v(design.r_ss, design.t_ss))));
}

// Map the accumulated choices to the Stan data block. Rows arrive as { ...design, choice }.
function buildData(trials) {
  return {
    N: trials.length,
    t_ss: trials.map((t) => t.t_ss),
    t_ll: trials.map((t) => t.t_ll),
    r_ss: trials.map((t) => t.r_ss),
    r_ll: trials.map((t) => t.r_ll),
    y:    trials.map((t) => t.choice),         // 1 = LL
  };
}

jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModel("exponential_dd", {
  stanCode: exponentialModel,
  params: ["k", "tau"],
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  responseProb,
  buildData,
});

// Compile any source-registered models once, at setup.
await jsPsychADO.prepareModels({ compileServer: "https://stan-wasm.flatironinstitute.org" });

const adoTrials = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: "exponential_dd",
  n_trials: 30,
});

jsPsych.run([instructions, ...adoTrials, end_screen]);
```

For a deployed study you would compile once and commit the artifact, so there is no compile step at run time.

## What you get

The adaptive fragment is a plain array of jsPsych trials — spread it into `jsPsych.run()` alongside anything else. Each choice row in the downloaded JSON carries the usual jsPsych fields plus the ADO state:

| Field | Meaning |
|---|---|
| `ado_design` | the design shown on this trial |
| `post_mean_<param>` / `post_sd_<param>` | posterior mean / SD of each parameter after this trial |
| `ado_max_mutual_info` | information gain of the chosen design |
| `choice_label` | human-readable response (e.g. `"LL"`) |
