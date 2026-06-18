## Usage

`jspsych-ado` runs adaptive design optimization (ADO) **entirely in the browser**.
A Stan model compiled to WebAssembly infers the posterior over the model parameters
after every trial, and the next design is chosen by maximizing mutual information
over a design grid. No Python, no server.

The general library lives in [`jspsych-ado/`](../../jspsych-ado) and is model- and
stimulus-agnostic. An experiment is a thin page that **registers a model** and asks
the `jsPsychADO` façade to build the timeline. Delay discounting (this folder, the
hyperbolic model) is the first example.

### Quick start (no code)

Open with Live Server — there is no build step:

```
experiments/delay_discounting/index.html?controller=stan&strategy=ado&debug=1
```

URL parameters:

- `controller=stan` (default) — live in-browser Stan inference in a Web Worker.
- `controller=mock` — deterministic, no-WASM controller for fast timeline/UI work.
- `strategy=ado` (default) — select designs by mutual information.
- `strategy=random` — keep the Stan posterior updates but sample designs randomly
  from the same grid for recovery/dev baselines.
- `debug=1` — per-trial console summary (design shown, response, posterior
  mean/sd for each parameter, next design, local sampling time) plus live
  posterior trajectory charts.
- `simulate=data-only` / `simulate=visual` — run a simulated participant
  (generate data with no clicks / watch jsPsych click through the run).

Legacy `ado=stan|mock|ado|random` URLs are still accepted as aliases, but new
examples should use `controller=` and `strategy=` so backend choice and design
policy stay distinct.

### Wiring it yourself (the façade)

Register a model, then build the timeline. A model package's `choiceProbLL` and
`buildData` are passed straight through (`linkProb` just flips the argument order);
the priors, the stimulus `presentation`, and the response labels come from the
package too, so a second model is just a second `registerModel` call. (If you don't
have a native `buildData`, supply `toStanData(trials:[{design,response}])` instead —
handy when registering from an inline Stan source string.)

```js
import { jsPsychADO } from "./jspsych-ado/index.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";

const jsPsych = initJsPsych();

jsPsychADO.registerModel("hyperbolic", {
  moduleUrl:     hyperbolicModel.moduleUrl,     // precompiled main.js (no compile step)
  prior:         hyperbolicModel.prior,
  params:        hyperbolicModel.params,
  design_grid:   default_dd_config.grid_design,
  linkProb:      (theta, design) => hyperbolicModel.choiceProbLL(design, theta),
  buildData:     hyperbolicModel.buildData,     // model's own Stan-data builder, used as-is
  response_labels:  hyperbolicModel.response_labels,
  presentation:     hyperbolicModel.presentation,
  choices:          hyperbolicModel.choices,
  posterior_display: hyperbolicModel.posterior_display,
  stan:     default_dd_config.stan,             // { num_chains, num_warmup, num_samples, seed }
  n_trials: default_dd_config.n_trials,
});

const timeline = jsPsychADO.createTimeline(jsPsych, {
  model: "hyperbolic",
  task: "delay_discounting",
}, { debug: true });                            // run_context

jsPsych.run(timeline);
```

If a model is registered from a Stan **source string** (`stanCode`) or a `.stan`
URL (`stanUrl`) instead of a precompiled `moduleUrl`, compile it once at study
setup before building any timelines:

```js
await jsPsychADO.prepareModels({ compileServer: "https://stan-wasm.flatironinstitute.org" });
```

### Dev path (mock controller, no WASM)

The generic timeline accepts any controller, so for fast UI iteration drive it
directly with the deterministic mock controller — no façade, no WASM:

```js
import { createAdoTimeline } from "./jspsych-ado/ado/ado_timeline.js";
import { createMockAdoController } from "./jspsych-ado/controllers/mock_ado_controller.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";

const controller = createMockAdoController({
  grid_design: default_dd_config.grid_design,
  params:      hyperbolicModel.params,
});
const run_context = {
  ado_mode:          "mock",
  controller_mode:   "mock",
  design_strategy:   null,
  model_id:          hyperbolicModel.id,
  debug:             true,
  posterior_display: hyperbolicModel.posterior_display,
};
const timeline = createAdoTimeline(jsPsych, controller, {
  n_trials:        default_dd_config.n_trials,
  response_labels: default_dd_config.response_labels,
  presentation:    hyperbolicModel.presentation,
  choices:         hyperbolicModel.choices,
  task:            "delay_discounting",
}, run_context);
```

### Adjusting the experiment

The knobs live in `default_dd_config` (or your own copy):

- `n_trials` — number of adaptive choice trials.
- `grid_design` — candidate designs the MI engine scores, as arrays of values
  (`{ t_ss, t_ll, r_ss, r_ll }`), or a curated array of design objects.
- `stan` — NUTS sampler settings: `num_chains`, `num_warmup`, `num_samples`,
  `seed`. More samples means better design selection but slower per-trial
  inference (Stan refits after every choice). Override per timeline via
  `createTimeline(jsPsych, { model, stan: { ... } })`.
- `response_labels` — labels by index: `{ 0: "SS", 1: "LL" }`.

### Adding a model

A model is a folder under `jspsych-ado/models/`. Three steps, no local compiler
toolchain required.

**1. Write the Stan model** at `jspsych-ado/models/<name>/<name>.stan` (likelihood
+ priors).

**2. Compile it once** with the public Flatiron server and drop the two artifacts
in the folder (keep the `main.js` / `main.wasm` names — `main.js` hardcodes loading
its sibling `main.wasm`):

```bash
cd jspsych-ado/models/<name>
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @<name>.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

(Or paste the model into https://stan-playground.flatironinstitute.org and download
`main.js` + `main.wasm`. Or run the server locally:
`docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest` and point
the URLs at `http://localhost:8083`.)

**3. Write the adapter** at `jspsych-ado/models/<name>/model.js`. It owns the
likelihood (mirroring the `.stan` block), the priors, and the **presentation** —
how a design is shown and answered. The generic timeline consumes `presentation`
through either the single-button convenience path (`makeStimulus` + optional
`button_html`/`keymap`/`prompt`) or `getChoiceTrials(ctx)` for multi-frame tasks.

```js
export default {
  id: "exponential",
  params: ["r", "tau"],                          // parameters to summarize
  prior: {                                        // MUST match <name>.stan priors
    r:   { dist: "lognormal", meanlog: -2, sdlog: 1 },
    tau: { dist: "halfnormal", sd: 3 },
  },
  posterior_display: {                            // optional chart labels/ranges (debug)
    r:   { label: "r", y_min: 0, y_max: 1, lower_bound: 0 },
    tau: { label: "τ", y_min: 0, y_max: 7, lower_bound: 0 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData: (trials) => ({                       // trials: {t_ss,t_ll,r_ss,r_ll,choice}
    N: trials.length,
    t_ss: trials.map(t => t.t_ss), t_ll: trials.map(t => t.t_ll),
    r_ss: trials.map(t => t.r_ss), r_ll: trials.map(t => t.r_ll),
    y:    trials.map(t => t.choice),
  }),
  choiceProbLL: (design, p) => {                  // P(LL); design first, param-draw second
    const vss = design.r_ss * Math.exp(-p.r * design.t_ss);
    const vll = design.r_ll * Math.exp(-p.r * design.t_ll);
    return 1 / (1 + Math.exp(-p.tau * (vll - vss)));
  },
  // Stimulus + response contract consumed by the generic timeline.
  presentation: {
    makeStimulus: (design) => `<p>Which would you prefer?</p>`,
    button_html:  (design) => [card(design, 0), card(design, 1)],
    keymap:       { s: 0, l: 1 },                 // physical key -> button index
    prompt:       "<p>Press S for sooner · L for later</p>",
  },
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" },
};
```

Then register it exactly like the hyperbolic model above and pass `model: "exponential"`
to `createTimeline`. `choiceProbLL` is the JS mirror of the `.stan` likelihood and
must agree with it; the adapter unit test (`tests/js/<name>.test.mjs`) guards the
formula.

For a task whose binary outcome depends on the design (e.g. "chose the more
numerous side"), add `responseToOutcome: (design, choiceIndex) => 0 | 1` to the
spec; it defaults to identity (the raw button index is the outcome), which is
correct for delay discounting.

### (Optional) Compile from a `.stan` string at setup

To keep the Stan source inline and skip the curl/commit step while prototyping,
`compileStanModel` compiles a source string at experiment setup and returns the
same adapter shape (minus `presentation`, which you still supply). It POSTs to the
same Flatiron server and points the adapter's `moduleUrl` at the compiled module —
the engine, worker, controller, and timeline are untouched.

```js
import { compileStanModel } from "./jspsych-ado/models/compile_stan_model.js";

const expModel = await compileStanModel({
  id: "exponential",
  stan: expStan,                                  // .stan source string
  params: ["r", "tau"],
  prior: { r: { dist: "lognormal", meanlog: -2, sdlog: 1 }, tau: { dist: "halfnormal", sd: 3 } },
  buildData: (trials) => ({
    N: trials.length,
    t_ss: trials.map(t => t.t_ss), t_ll: trials.map(t => t.t_ll),
    r_ss: trials.map(t => t.r_ss), r_ll: trials.map(t => t.r_ll),
    y:    trials.map(t => t.choice),
  }),
  choiceProbLL: (design, p) => {
    const vss = design.r_ss * Math.exp(-p.r * design.t_ss);
    const vll = design.r_ll * Math.exp(-p.r * design.t_ll);
    return 1 / (1 + Math.exp(-p.tau * (vll - vss)));
  },
});
```

`compileStanModel` is for prototyping: the compiled module is fetched from the
compile server at run time, so every participant load depends on that server. For a
deployed study, download `main.js` + `main.wasm` once with the curl above, commit
them, and write a normal `model.js` so the live experiment is pure static assets
with no third-party runtime dependency.

### What gets logged

Each choice trial records the design shown (its design keys, e.g. `t_ss`, `t_ll`,
`r_ss`, `r_ll`), the response (`choice`, `choice_raw`, `choice_label`, and the full
`ado_design` object), the per-trial posterior summaries named from the model's
parameters (`post_mean_<param>`, `post_sd_<param>`, e.g. `post_mean_k`), and timing.
Run-level properties include `controller_mode`, `design_strategy`, `ado_mode`
(legacy/debug summary), and `model_id`; under `simulate`, the data-generating
`sim_<param>` values are saved too.
