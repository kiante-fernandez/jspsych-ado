# Bring your own task — money choice

**Pattern 2** (see [`../README.md`](../README.md)): supply your **own task**, reuse a
**packaged model**. This demo pairs a task written from scratch ([`task.js`](task.js))
— a plain-text "money now vs. later" framing — with the packaged **hyperbolic** model,
unchanged. A task and a model are independent, so the only thing that differs from the
[delay-discounting demo](../delay_discounting/) is which task we import.

Run it (serve the repo statically):

```text
demos/byo_task_money_choice/index.html?controller=stan&strategy=ado&debug=1
```

## What a task owns

[`task.js`](task.js) is the whole task. A task defines three things:

1. **`design_grid`** — the candidate designs ADO chooses among. Here a from-scratch
   grid over the same delay-discounting design space (`t_ss`, `t_ll`, `r_ss`, `r_ll`),
   built with the shipped `arange` helper.
2. **`presentation`** — how a design is shown and answered: `makeStimulus(design)`,
   `button_html(design)` (two plain buttons), and a `keymap` (`A` = sooner, `B` = later).
3. **Response coding** — `choices` / `response_labels` with `0` = smaller-sooner,
   `1` = larger-later. This must match what the model's likelihood expects (the
   hyperbolic model's `y` is `1` = chose larger-later), so the two compose correctly.

That's it — no model, no Stan, no engine code. You register it with
`jsPsychADO.registerTask(task.id, task)` and pair it with any compatible model.

## How it's used here

```js
import moneyChoiceTask from "./task.js"; // your task
import hyperbolicModel from ".../models/hyperbolic/model.js"; // packaged model

jsPsychADO.registerTask(moneyChoiceTask.id, moneyChoiceTask);
jsPsychADO.registerModelPackage(hyperbolicModel, { stan, n_trials: 42 });
const ado = jsPsychADO.createTimeline(jsPsych, {
  task: moneyChoiceTask.id,
  model: hyperbolicModel.id,
});
```

`createTimeline` validates that the task and model are compatible (the task's design
keys cover what the model reads, the response spaces agree) before building the
timeline, so a mismatch fails loudly up front.

(For runnability this page goes through the shared demo "experiment shell" — URL
switches + simulation — like the other demos. The interface is the calls above.)
