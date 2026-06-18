## Usage

`jspsych-ado` runs adaptive design optimization (ADO) entirely in the browser. A
Stan model compiled to WebAssembly infers the posterior over model parameters,
and the next design is chosen by maximizing mutual information over a task design
grid. No Python and no server are needed at run time.

The package separates three concepts:

- **task**: design grid, stimulus presentation, choices, response labels
- **model**: parameters, priors, likelihood, Stan data builder, compiled WASM
- **controller**: how designs/posteriors are updated (`stan`, `mock`, `quest_plus`)

### Quick start

Open with Live Server; there is no build step:

```text
experiments/delay_discounting/index.html?controller=stan&strategy=ado&debug=1
```

URL parameters:

- `controller=stan` (default) — live in-browser Stan inference in a Web Worker.
- `controller=mock` — deterministic, no-WASM controller for fast timeline/UI work.
- `controller=quest_plus` — discrete-grid Quest+ comparator.
- `strategy=ado` (default) — select Stan designs by mutual information.
- `strategy=random` — keep Stan posterior updates but sample designs randomly
  from the same grid.
- `debug=1` — per-trial console summaries, design-selection diagnostics, and
  live posterior trajectory charts.
- `simulate=data-only` / `simulate=visual` — run a simulated participant.

Legacy `ado=stan|mock|ado|random|quest_plus` URLs are still accepted as aliases,
but new examples should use `controller=` and `strategy=`.

### Wiring the facade

Register the task and model separately, then build the timeline from both:

```js
import { jsPsychADO } from "./jspsych-ado/index.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";

const jsPsych = initJsPsych();

jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(hyperbolicModel, {
  stan: default_dd_config.stan,
  n_trials: default_dd_config.n_trials,
  testlet_size: default_dd_config.testlet_size,
});

const timeline = jsPsychADO.createTimeline(jsPsych, {
  task: delayDiscountingTask.id,
  model: hyperbolicModel.id,
  design_strategy: "ado",
}, { debug: true });

jsPsych.run(timeline);
```

`createTimeline` checks task/model compatibility before it builds the controller:
the model's `designKeys` must be present in the task grid, both response spaces
must match, and the model's `responseProb`/`buildData` must work on one task
design.

### Dev path (mock controller, no WASM)

The generic timeline accepts any controller, so fast UI iteration can drive the
same task presentation with the deterministic mock controller:

```js
import { createAdoTimeline } from "./jspsych-ado/ado/ado_timeline.js";
import { createMockAdoController } from "./jspsych-ado/controllers/mock_ado_controller.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "./jspsych-ado/tasks/delay_discounting/task.js";
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";

const controller = createMockAdoController({
  grid_design: delayDiscountingTask.design_grid,
  params: hyperbolicModel.params,
  n_trials: default_dd_config.n_trials,
  testlet_size: default_dd_config.testlet_size,
});

const timeline = createAdoTimeline(jsPsych, controller, {
  n_trials: default_dd_config.n_trials,
  testlet_size: default_dd_config.testlet_size,
  response_labels: delayDiscountingTask.response_labels,
  presentation: delayDiscountingTask.presentation,
  choices: delayDiscountingTask.choices,
  task: delayDiscountingTask.id,
}, {
  controller_mode: "mock",
  model_id: hyperbolicModel.id,
  posterior_display: hyperbolicModel.posterior_display,
});
```

### Adding a task

A task package lives under `jspsych-ado/tasks/`. It owns the design grid and the
stimulus/response contract:

```js
export default {
  id: "delay_discounting",
  design_grid: { t_ss: [0], t_ll: [1, 52], r_ss: [100, 400], r_ll: [800] },
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  presentation: {
    makeStimulus: (design) => "<p>Which would you prefer?</p>",
    button_html: (design) => [ssCard(design), llCard(design)],
    keymap: { s: 0, l: 1 },
  },
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" },
};
```

For tasks where the binary model outcome differs from the raw button index, add
`responseToOutcome: (design, choiceIndex) => 0 | 1`.

### Adding a model

A model package lives under `jspsych-ado/models/`. It owns the statistical pieces:

```js
export default {
  id: "exponential",
  params: ["r", "tau"],
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  prior: {
    r: { dist: "lognormal", meanlog: -2, sdlog: 1 },
    tau: { dist: "halfnormal", sd: 3 },
  },
  posterior_display: {
    r: { label: "r", y_min: 0, y_max: 1, lower_bound: 0 },
    tau: { label: "τ", y_min: 0, y_max: 7, lower_bound: 0 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData: (trials) => ({
    N: trials.length,
    t_ss: trials.map(t => t.t_ss),
    t_ll: trials.map(t => t.t_ll),
    r_ss: trials.map(t => t.r_ss),
    r_ll: trials.map(t => t.r_ll),
    y: trials.map(t => t.choice),
  }),
  responseProb: (design, p) => {
    const vss = design.r_ss * Math.exp(-p.r * design.t_ss);
    const vll = design.r_ll * Math.exp(-p.r * design.t_ll);
    return 1 / (1 + Math.exp(-p.tau * (vll - vss)));
  },
};
```

`responseProb` must match the `.stan` likelihood. Add a focused unit test for the
formula and metadata before using the model in a browser experiment.

### Compiling a model

Write the Stan model at `jspsych-ado/models/<name>/<name>.stan`, compile it once,
and commit `main.js` + `main.wasm` next to `model.js`:

```bash
cd jspsych-ado/models/<name>
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @<name>.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

The optional `compileStanModel` helper can compile from a source string at study
setup while prototyping, but deployed studies should use committed compiled assets.

### What gets logged

Each choice trial records the design shown, the response (`choice`, `choice_raw`,
`choice_label`, and `ado_design`), per-trial posterior summaries named from model
parameters (`post_mean_<param>`, `post_sd_<param>`), design-selection diagnostics
(`ado_mutual_info`, `ado_selection_time_ms`), and timing. Run-level properties
include `controller_mode`, `design_strategy`, `ado_mode`, and `model_id`;
simulated runs also save data-generating `sim_<param>` values.
