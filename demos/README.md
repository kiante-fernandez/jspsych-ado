# Demos

Runnable examples of `jspsych-ado`, each one showing a different way to use the
package. Serve the repo with any static server (VS Code Live Server, etc.) and open
a demo's `index.html`.

## `tasks/` vs `demos/` — what's the difference?

This trips people up, so first:

- **`src/tasks/<name>/`** and **`src/models/<name>/`** are **packaged,
  reusable, shipped-on-npm** pieces. A **task** owns _how a design is shown and answered_
  (presentation, the candidate **design grid**, response coding). A **model** owns _the
  likelihood_ (a Stan file + a small JS adapter: priors, `responseProb`, `stanData`).
  They are deliberately separate so you can mix and match.
- **`demos/<name>/`** are **example pages** that _consume_ those packages (or _author_
  new ones) and wire them into a runnable jsPsych experiment. Nothing in `demos/` is
  part of the published library — they're how-to examples.

So: the library gives you tasks + models; a demo is an experiment page that uses them.

## The four ways to use the package

| Demo                                                         | Task              | Model             | What it teaches                                                            |
| ------------------------------------------------------------ | ----------------- | ----------------- | -------------------------------------------------------------------------- |
| [`delay_discounting/`](delay_discounting/)                   | packaged          | packaged          | **Drop-in** — the minimal interface; plain-jsPsych-vs-ADO                  |
| [`halberda_dot_comparison/`](halberda_dot_comparison/)       | packaged          | packaged          | Drop-in (binary correctness / ANS)                                         |
| [`line_length_discrimination/`](line_length_discrimination/) | packaged          | packaged          | Drop-in (3-way categorical)                                                |
| [`magnitude_estimation/`](magnitude_estimation/)             | packaged          | packaged          | Drop-in (**continuous** slider response / Stevens power law)               |
| [`byo_task_*/`](.)                                           | **authored here** | packaged          | **Bring your own task** — `registerTask` a new presentation, reuse a model |
| [`byo_model_exponential/`](.)                                | packaged          | **authored here** | **Bring your own model** — a new `.stan` + adapter, reuse a task           |

The two "bring your own" demos are the heart of it: a **task** and a **model** are
independent, so you can swap either one while keeping the other.

## The interface, minimally

Using a packaged task + model is three calls — everything else on a demo page is
ordinary jsPsych (instructions, an end screen) or demo scaffolding (URL switches,
simulation):

```js
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";
import callFunction from "@jspsych/plugin-call-function";

import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "jspsych-ado/tasks/delay_discounting/task.js";
import "jspsych-ado/tasks/delay_discounting/task.css";

const jsPsych = initJsPsych();

// (1) register the packaged task and (2) the packaged model
jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(hyperbolic, {
  stan: { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 },
  n_trials: 42,
});

// (3) build the adaptive timeline fragment and run it
const ado = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: hyperbolic.id,
  plugins: { htmlButtonResponse, callFunction },
});
jsPsych.run([/* instructions, */ ...ado /*, end screen */]);
```

(On a static page that loads jsPsych + plugins via `<script>` tags, the plugins are
read from the globals and you can omit `plugins`. The in-repo demos do this.)

## Plain jsPsych vs ADO — what actually changes

A standard jsPsych experiment **pre-specifies every trial**:

```js
const timeline = [
  instructions,
  { type: htmlButtonResponse, stimulus: offerHTML(40, 80), choices: ["A", "B"] }, // fixed
  { type: htmlButtonResponse, stimulus: offerHTML(20, 100), choices: ["A", "B"] }, // fixed
  // ...you choose all the stimuli up front...
  end,
];
jsPsych.run(timeline);
```

With ADO you **don't write the trials** — you hand over a task + model and let the
loop choose each trial's stimulus to be the most informative one given the responses
so far:

```js
jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(hyperbolic, { stan, n_trials: 42 });
const ado = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: hyperbolic.id,
});
jsPsych.run([instructions, ...ado, end]);
```

What's different:

- **The trial list isn't fixed.** After each response, a Stan model re-estimates the
  posterior and the next design is the one that maximizes expected information gain.
- **Extra data columns appear** on each row: `post_mean_<param>` / `post_sd_<param>`
  (the running estimate), `ado_design`, `ado_max_mutual_info`, and (if adaptive
  stopping is on) `ado_should_stop` / `ado_stop_reason`.
- Everything else — instructions, end screen, `jsPsych.run`, data handling — is
  ordinary jsPsych.

## Running a demo

Serve the repo statically and open, e.g.:

```text
demos/delay_discounting/index.html?controller=stan&strategy=ado&debug=1
```

URL switches the demo pages understand (via the shared demo harness, not part of the
library API):

- `controller=stan` (default) — live in-browser Stan inference; `controller=mock` — a
  deterministic, no-WASM controller for fast UI work.
- `strategy=ado` (default) — MI-optimal designs; `strategy=random` — a random baseline.
- `debug=1` — per-trial console summary + live posterior charts.
- `simulate=data-only` | `simulate=visual` — run a simulated participant.
