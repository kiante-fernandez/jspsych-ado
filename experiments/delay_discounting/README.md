# Delay discounting

An ADOpy-style delay discounting experiment whose adaptive inference runs entirely
in the browser with a Stan model compiled to WebAssembly.

This experiment is a thin consumer of the general [`jspsych-ado/`](../../jspsych-ado)
package. `index.html` registers a delay-discounting task, registers the hyperbolic
model, and uses the shared experiment shell to build the adaptive timeline:

```js
import {
  createExperimentAdoTimeline,
  registerAdoExperiment,
} from "./jspsych-ado/ado/experiment_shell.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";

registerAdoExperiment({ task: delayDiscountingTask, model: hyperbolicModel, config });

const timeline = createExperimentAdoTimeline(jsPsych, {
  task: delayDiscountingTask,
  model: hyperbolicModel,
  config,
  run_context,
  controller_factories,
});
```

What lives where:

- **All adaptive machinery is in `jspsych-ado/`** — the MI engine, the in-browser
  Stan controller + Web Worker, the generic timeline, and the facade.
- **The delay-discounting task package** owns the design grid, SS/LL option cards,
  S/L keymap, response labels, and task id.
- **The hyperbolic model package** owns the likelihood (`responseProb`/`.stan`),
  priors, posterior display metadata, and Stan data builder.
- **This folder** holds the page and run settings: sampler config, optional
  Quest+ parameter samples, trial count, testlet size, and simulation config.

Response coding:

- `choice = 0`: smaller-sooner option
- `choice = 1`: larger-later option (`y` in the Stan model)
