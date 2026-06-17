## Usage

`jspsych-ado` runs adaptive design optimization (ADO) for delay discounting
**entirely in the browser**. A Stan model compiled to WebAssembly infers the
posterior over the discounting parameters after every trial, and the next
smaller-sooner / larger-later (SS/LL) offer is chosen by maximizing mutual
information over a design grid. No Python, no server.

### Quick start (no code)

Open with Live Server — there is no build step:

```
experiments/delay_discounting/index.html?ado=stan&debug=1
```

URL parameters:

- `ado=stan` (default) — live in-browser Stan inference + ADO in a Web Worker.
- `ado=mock` — deterministic, no-WASM controller for fast timeline/UI work.
- `debug=1` — per-trial console summary (design shown, response, posterior
  mean/sd for each parameter, next design, local sampling time).
- `simulate=data-only` / `simulate=visual` — run a simulated participant
  (generate data with no clicks / watch jsPsych click through the run).

### Wiring it yourself

Three pieces: a **model adapter**, a **controller**, and the **timeline**.
Import a model, build a controller, and hand the controller to the timeline.

```js
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";
import { createStanAdoController } from "./experiments/delay_discounting/controllers/stan_ado_controller.js";
import { createDelayDiscountingTimeline } from "./experiments/delay_discounting/delay_discounting_timeline.js";
import hyperbolicModel from "./experiments/delay_discounting/models/hyperbolic/model.js";

const jsPsych = initJsPsych();

const controller = createStanAdoController({
  model: hyperbolicModel,
  grid_design: default_dd_config.grid_design,
  stan: default_dd_config.stan,        // { num_chains, num_warmup, num_samples, seed }
  n_trials: default_dd_config.n_trials,
});

const timeline = createDelayDiscountingTimeline(
  jsPsych,
  controller,
  default_dd_config,
  { debug: true }                      // run_context
);

jsPsych.run(timeline);
```

For fast UI iteration with no WASM, swap in the mock controller — everything else
is identical:

```js
import { createMockAdoController } from "./experiments/delay_discounting/controllers/mock_ado_controller.js";

const controller = createMockAdoController(default_dd_config);
```

### Adjusting the experiment

The knobs live in `default_dd_config` (or your own copy). Override inline when you
build the controller:

```js
const controller = createStanAdoController({
  model: hyperbolicModel,
  grid_design: default_dd_config.grid_design,
  stan: { num_chains: 4, num_warmup: 500, num_samples: 1000, seed: 42 },
  n_trials: 40,
});
```

- `n_trials` — number of adaptive choice trials.
- `grid_design` — candidate SS/LL designs the MI engine scores, as arrays:
  `{ t_ss, t_ll, r_ss, r_ll }`.
- `stan` — NUTS sampler settings: `num_chains`, `num_warmup`, `num_samples`,
  `seed`. More samples means better design selection but slower per-trial
  inference (Stan refits after every choice).
- `response_labels` — button labels by index: `{ 0: "SS", 1: "LL" }`.

### Adding a discounting model

A model is a folder under `models/`. Three steps, no local compiler toolchain
required.

**1. Write the Stan model** at `models/<name>/<name>.stan` (likelihood + priors).

**2. Compile it once** with the public Flatiron server and drop the two artifacts
in the folder (keep the `main.js` / `main.wasm` names — `main.js` hardcodes loading
its sibling `main.wasm`):

```bash
cd experiments/delay_discounting/models/<name>
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

**3. Write the adapter** at `models/<name>/model.js`. The default export is the
object `createStanAdoController` consumes:

```js
export default {
  id: "exponential",
  params: ["r", "tau"],                          // parameters to summarize
  prior: {                                        // MUST match <name>.stan priors
    r:   { dist: "lognormal", mu: -2, sigma: 1 },
    tau: { dist: "halfnormal", sigma: 3 },
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
};
```

Then import it where you build the controller
(`import expModel from "./models/exponential/model.js"`) and pass it as `model`.
`choiceProbLL` is the JS mirror of the `.stan` likelihood and must agree with it;
the adapter unit test (`tests/js/<name>.test.mjs`) guards the formula.

### (Optional) Compile from a `.stan` string at setup

To keep the Stan source inline and skip the curl/commit step while prototyping,
`compileStanModel` compiles a source string at experiment setup and returns the
same adapter shape. It POSTs to the same Flatiron server and points the adapter's
`moduleUrl` at the compiled module — the engine, worker, and controller are
untouched.

```js
import { compileStanModel } from "./experiments/delay_discounting/models/compile_stan_model.js";

const expStan = `
data {
  int<lower=0> N;
  array[N] real t_ss; array[N] real t_ll;
  array[N] real r_ss; array[N] real r_ll;
  array[N] int<lower=0,upper=1> y;
}
parameters { real<lower=0> r; real<lower=0> tau; }
model {
  r   ~ lognormal(-2, 1);
  tau ~ normal(0, 3);
  for (n in 1:N) {
    real vss = r_ss[n] * exp(-r * t_ss[n]);
    real vll = r_ll[n] * exp(-r * t_ll[n]);
    y[n] ~ bernoulli_logit(tau * (vll - vss));
  }
}`;

const expModel = await compileStanModel({
  id: "exponential",
  stan: expStan,
  params: ["r", "tau"],
  prior: { r: { dist: "lognormal", mu: -2, sigma: 1 }, tau: { dist: "halfnormal", sigma: 3 } },
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

const controller = createStanAdoController({
  model: expModel,
  grid_design: default_dd_config.grid_design,
  stan: default_dd_config.stan,
  n_trials: default_dd_config.n_trials,
});
```

`compileStanModel` is for prototyping: the compiled module is fetched from the
compile server at run time, so every participant load depends on that server (and
on cross-origin access to it). For a deployed study, download `main.js` +
`main.wasm` once with the curl above, commit them, and write a normal `model.js`
so the live experiment is pure static assets with no third-party runtime
dependency.

### What gets logged

Each choice trial records the design shown (`t_ss`, `t_ll`, `r_ss`, `r_ll`), the
response (`choice`, `choice_label`), the per-trial posterior summaries named from
the model's parameters (`post_mean_<param>`, `post_sd_<param>`, e.g.
`post_mean_k`), and timing. Run-level properties include `ado_mode` and
`model_id`; under `simulate`, the data-generating `sim_<param>` values are saved
too.
