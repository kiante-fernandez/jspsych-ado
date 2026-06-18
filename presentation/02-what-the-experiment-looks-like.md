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

The single `registerModelPackage(hyperbolicModel)` line above quietly bundled four things the package author had already written for you: a Stan program, a JavaScript link function, a data-builder, and a precompiled WebAssembly artifact. Bringing your own model means writing those pieces yourself — the surrounding calls (`registerModel` → `prepareModels` → `createTimeline`) stay the same. We reuse the built-in delay-discounting **task** unchanged (it owns the stimulus and the grid of possible offers) and replace only the **model**, swapping hyperbolic discounting for an exponential value function.

First, the imports and setup — note there is no longer a model package to import, because you are about to define the model:

```js
import { initJsPsych } from "jspsych";
import { jsPsychADO } from "./jspsych-ado/index.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";

const jsPsych = initJsPsych();
```

### a) The Stan model — what gets fit after each response

This is the Bayesian model Stan runs in the browser to update its beliefs about the parameters as choices accumulate. The `data` block declares what each trial contributes; `parameters` lists the unknowns; the `~` statements are their priors; and the final `y ~ bernoulli_logit(...)` is the likelihood tying a design and the parameters to the choice. You do **not** restate the priors in JavaScript — jspsych-ado reads them straight from these `~` lines. The only substantive change from the built-in model is the value function: `exp(-k * t)` in place of hyperbolic `1 / (1 + k * t)`.

```js
const exponentialModel = `
  data {
    int<lower=1> N;
    vector[N] t_ss; vector[N] t_ll;
    vector[N] r_ss; vector[N] r_ll;
    array[N] int<lower=0, upper=1> y;          // 1 = chose larger-later
  }
  parameters { real<lower=0> k; real<lower=0> tau; }
  model {
    k   ~ lognormal(-2.0, 1.0);                // priors are read from here
    tau ~ lognormal(-1.0, 1.0);
    for (n in 1:N) {
      real v_ll = r_ll[n] * exp(-k * t_ll[n]); // exponential, not hyperbolic
      real v_ss = r_ss[n] * exp(-k * t_ss[n]);
      y[n] ~ bernoulli_logit(tau * (v_ll - v_ss));
    }
  }
`;
```

### b) The JavaScript link function — what picks the next question

At first glance this looks redundant: you just wrote the likelihood in Stan, and now you write it again in JavaScript. But the two do different jobs at different moments. Stan fits the *posterior* — relatively slow, run once per response. Choosing the *next* design then requires scoring every candidate offer in the grid by how much information it is expected to reveal, which means evaluating the choice probability at thousands of design × posterior-draw combinations on every trial — far too many to hand back to Stan. So jspsych-ado needs a plain, fast JavaScript function that returns P(choose LL) for one design and one parameter draw. It must produce the same probability your Stan likelihood implies — it is a mirror of it — or design selection and inference would disagree. Note the argument order: `(design, params)`, **design first**.

```js
function responseProb(design, { k, tau }) {
  const v = (r, t) => r * Math.exp(-k * t);
  return 1 / (1 + Math.exp(-tau * (v(design.r_ll, design.t_ll) - v(design.r_ss, design.t_ss))));
}
```

### c) The data-builder — translating jsPsych rows into Stan input

jspsych-ado accumulates responses as flat rows, one per trial: `{ t_ss, t_ll, r_ss, r_ll, choice }`. Stan instead wants columns — a single object of equal-length arrays. `buildData` does that reshape, and the keys it returns **must match the names you declared in the Stan `data` block** (here `choice`, the 0/1 outcome, becomes `y`).

```js
function buildData(trials) {                   // trials: [{ t_ss, t_ll, r_ss, r_ll, choice }]
  return {
    N: trials.length,
    t_ss: trials.map((t) => t.t_ss),
    t_ll: trials.map((t) => t.t_ll),
    r_ss: trials.map((t) => t.r_ss),
    r_ll: trials.map((t) => t.r_ll),
    y:    trials.map((t) => t.choice),         // 1 = LL
  };
}
```

### d) Register, compile once, then run

`registerModel` files these pieces under a name; `designKeys` tells it which fields of each design the model reads (they must exist in the task's grid). The built-in package shipped already compiled, but your Stan source is just text — and Stan cannot run in a browser as source, so it has to be compiled to WebAssembly first. `prepareModels` sends the source to a Stan-to-WASM compile server once at setup and caches the result. After that, `createTimeline` is identical to the built-in case.

```js
jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModel("exponential_dd", {
  stanCode: exponentialModel,
  params: ["k", "tau"],
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  responseProb,
  buildData,
});

// Compile any source-registered models once, at setup (skip if precompiled).
await jsPsychADO.prepareModels({ compileServer: "https://stan-wasm.flatironinstitute.org" });

const adoTrials = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: "exponential_dd",
  n_trials: 30,
});

jsPsych.run([instructions, ...adoTrials, end_screen]);
```

For a deployed study you would compile once and commit the artifact, so there is no compile step at run time.

### What you actually had to add

| Piece | Built-in hyperbolic | Custom model |
|---|---|---|
| Stan model (likelihood) | bundled | you write `stanCode` |
| Priors | bundled | read from your Stan `~` statements |
| Link function (design selection) | bundled | you write `responseProb` |
| Data-builder | bundled | you write `buildData` |
| Compiled WebAssembly | shipped precompiled | `prepareModels` compiles once at setup |
| Task: stimulus + design grid | reused unchanged | reused unchanged |

## What you get

The adaptive fragment is a plain array of jsPsych trials — spread it into `jsPsych.run()` alongside anything else. Each choice row in the downloaded JSON carries the usual jsPsych fields plus the ADO state:

| Field | Meaning |
|---|---|
| `ado_design` | the design shown on this trial |
| `post_mean_<param>` / `post_sd_<param>` | posterior mean / SD of each parameter after this trial |
| `ado_max_mutual_info` | information gain of the chosen design |
| `choice_label` | human-readable response (e.g. `"LL"`) |
