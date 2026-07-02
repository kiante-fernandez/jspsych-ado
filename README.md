<p align="center">
  <img src="https://raw.githubusercontent.com/jspsych/jspsych-ado/main/jspsych-ado.png" alt="jspsych-ado — the adaptive loop: model → design → stimulus → response → update" width="180">
</p>

<h1 align="center">jspsych-ado</h1>

<p align="center"><strong>Adaptive design optimization (ADO), entirely in the browser, for jsPsych experiments.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/jspsych-ado">
    <img src="https://img.shields.io/npm/v/jspsych-ado.svg" alt="npm version">
  </a>
  <a href="https://github.com/jspsych/jspsych-ado/actions/workflows/ci.yml">
    <img src="https://github.com/jspsych/jspsych-ado/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/jspsych/jspsych-ado/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/jspsych-ado.svg" alt="MIT license">
  </a>
</p>

## Overview

`jsPsychADO` runs **adaptive** jsPsych experiments: instead of a fixed trial list, it
picks each trial's stimulus to be the most informative one for estimating your
participant's parameters — so you learn more from fewer trials.

Under the hood, after each trial (or block of trials) a Stan model — compiled to
WebAssembly and run in a Web Worker via [tinystan](https://github.com/WardBrian/tinystan)
— estimates the posterior over your model's parameters, and the next design is chosen by
maximizing **mutual information** over a grid of candidate designs. There is **no server
and no Python**: everything runs client-side, so an experiment deploys as static assets.

You bring a **task** (design grid + presentation) and a **model** (Stan likelihood + a
small JS adapter); `jsPsychADO` checks that they are compatible and turns them into an
adaptive jsPsych timeline. Responses can be **binary, finite-categorical, or continuous** —
the engine enumerates outcomes for discrete responses and integrates the predictive density
for continuous ones. Or start from one of the bundled task/model packages, ready to run out
of the box.

## Status

🚧 **Early release — published on npm as [`jspsych-ado`](https://www.npmjs.com/package/jspsych-ado)**
(`npm install jspsych-ado`; current version in the badge above). The in-browser engine
and four bundled examples — binary delay discounting, Halberda-style dot comparison, 3IFC
categorical line-length, and continuous magnitude estimation (Stevens' power law) — work
and are covered by CI (unit tests + real headless Worker/WASM smokes + a bundler build
smoke). The committed WASM is bundler-safe and the package builds under Vite and webpack 5
(see [Using with a bundler](#using-with-a-bundler)). Still pre-1.0: the
task/model/controller extension APIs may change before 1.0.

## Quick start

No build step — serve the repo with any static server (VS Code Live Server, etc.) and
open the example:

```text
demos/delay_discounting_tutorial/index.html?debug=1
demos/size_discrimination/index.html?debug=1
demos/delay_discounting/index.html?debug=1
demos/line_length_discrimination/index.html?debug=1
demos/halberda_dot_comparison/index.html?debug=1
demos/magnitude_estimation/index.html?debug=1
```

See **[`demos/README.md`](demos/README.md)** for a guided tour: start with the
minimal `delay_discounting_tutorial/`, then the fuller demos (binary, categorical,
canvas, and continuous responses), plus two that show how to **bring your own task
code** (`demos/byo_task_money_choice/`) or **bring your own model**
(`demos/byo_model_exponential/`).

- `debug=1` — per-trial console summary, selection diagnostics when available,
  live posterior-convergence charts, and a posterior debrief overlay at the end
  (handled by the library; no demo scaffolding needed).
- Controller/strategy switches (`controller: "mock"`, `design_strategy: "random"`)
  are ordinary `createController` options in the experiment code rather than URL
  flags; the magnitude-estimation demo shows a demo-owned `?simulate=data-only`
  flag wired through the `simulate` option.

## Usage

Your experiment is ordinary jsPsych code: create a controller for a model + design
grid, read the current design inside your own trial, and record the response from its
`on_finish`. `ado.createTimeline(...)` wraps your trial into the adaptive loop and
owns the scheduling guarantee — the model update is awaited before the next trial
renders (this relies on jsPsych ≥ 8 awaiting async `on_finish`). The example below is
for a **bundler** project (`npm install jspsych-ado`); see
[Using with a bundler](#using-with-a-bundler) for the required setup, and
[Quick start](#quick-start) above for running the in-repo examples by serving the
repo statically.

```js
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";

import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";

const jsPsych = initJsPsych();

const ado = jsPsychADO.createController(jsPsych, {
  model: hyperbolic,
  design_grid: {
    t_ss: [0],
    t_ll: [1, 4, 12, 26, 52],
    r_ss: [100, 200, 400, 600],
    r_ll: [800],
  },
  stan: { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 },
  n_trials: 42,
});

const trial = {
  type: htmlButtonResponse,
  stimulus: () =>
    `$${ado.evaluateDesignVariable("r_ss")} now, or ` +
    `$${ado.evaluateDesignVariable("r_ll")} in ${ado.evaluateDesignVariable("t_ll")} weeks?`,
  choices: ["Sooner", "Later"],
  // The recorded value is the MODEL outcome (binary 0/1 here). For button trials the
  // raw response already is the outcome index; keyboard/slider tasks map it first.
  on_finish: (data) => ado.recordResponse(data.response),
};

jsPsych.run([/* instructions, */ ...ado.createTimeline(trial) /*, end screen */]);
```

One adaptive step can also be an **array of trials** (fixation → stimulus →
response; the last trial collects the response by default) or a **trial factory**
`(ctx) => trial(s)` — see the halberda demo for a canvas task built this way.

### Using with a bundler

The package is ESM and runs **client-side only** (it spawns a Web Worker that loads
the Stan WASM). It is tested against Vite and webpack 5.

- **jsPsych plugins.** Your trials are ordinary jsPsych trials, so you install and
  import whichever response plugins your task uses and put them on the trial's
  `type` yourself — the library never constructs plugin trials and has no plugin
  peer dependencies. jsPsych ≥ 8 is the only peer dependency (the scheduling
  guarantee relies on v8 awaiting async `on_finish`).
- **Vite.** The worker and WASM are emitted from `new URL(..., import.meta.url)`
  inside the installed dependency. If Vite's dep pre-bundling interferes with that
  emission, exclude the package: `optimizeDeps: { exclude: ["jspsych-ado"] }`.
- **webpack 5.** Works out of the box (first-class `new Worker(new URL(...))` and
  WASM asset support); no extra config needed.
- **SSR / Next.js.** Build the timeline only in the browser (e.g. behind
  `useEffect` / a `"use client"` component) — the Worker and WASM are not available
  during server rendering.

### API

- `createController(jsPsych, { model, design_grid, stan, n_trials, ... })` — validate the
  model/grid pair and return the controller handle.
- `ado.evaluateDesignVariable(key)` / `ado.designVariable(key)` / `ado.getDesign()` — read
  the current ADO-selected design inside your trial's dynamic parameters.
- `ado.recordResponse(outcome)` — record the model outcome from the adaptive trial's
  `on_finish` (validated against the model's response space).
- `ado.createTimeline(trialOrTrials, options)` — wrap your trial(s) into the adaptive
  loop; options override `n_trials`, `stopping`, `testlet_size`, `controller: "mock"`,
  `design_strategy: "random"`, `debug`, `response_labels`, `simulate`, ….
- `ado.getState()` — the live posterior summaries and selection diagnostics.
- `prepareModel(spec, { compileServer })` — compile a Stan-source model spec into a
  model package (prototyping path; committed models skip this).

### Adaptive stopping

Beyond choosing each design, the loop can decide **when to stop**. The criterion uses
the same currency as design selection — the expected information gain (EIG = the
mutual information `I(θ; y | d)` between the parameters and the response under a
design). It stops once the **best available next design's EIG** falls below a
**fraction of the maximum achievable EIG** (`ln(K)` nats for a `K`-category response):
i.e. no remaining stimulus is expected to teach much more. Using a fraction keeps one
threshold meaningful across binary and categorical tasks.

Pass a `stopping` config to `createController` (or per-timeline to `ado.createTimeline`):

```js
stopping: {
  eig_fraction: 0.1,   // stop when best next-design EIG < 0.1 * ln(K); omit to disable
  min_trials: 8,       // never stop before this many trials
  max_trials: 42,      // hard cap (defaults to n_trials)
  consecutive: 1,      // require this many sub-threshold refits in a row (de-bounce)
}
```

Omit `stopping` (or `eig_fraction`) for a fixed-length run of `n_trials`. Each row
records `ado_should_stop` and `ado_stop_reason` (`"eig_fraction"` or `"max_trials"`);
the EIG that drove the decision is the grid-max MI in `ado_max_mutual_info`. A
complementary precision-target rule is tracked in
[#101](https://github.com/jspsych/jspsych-ado/issues/101).

### Debug traces

`debug=1` prints a readable console summary after each adaptive update — the design
presented, the response, posterior mean/sd for the active model parameters, the next
selected design, and the local sampling time. In DevTools each summary also has a
collapsed details group with tables.

With the Stan controller, debug output also includes posterior draw histograms, an
on-page information-gain panel, and a dismissible posterior debrief overlay at the end
of the run. The panel plots the mutual information of the design that was actually
selected on each trial plus realized information gain after the response. Under
`design_strategy: "ado"`, the selected-design MI is the max-MI design by construction;
under `"random"`, it is the MI of the randomly sampled design, so it should not be
read as an optimality claim. The fast `controller: "mock"` path does not fabricate
these quantitative validation metrics; it remains for timeline/UI smoke testing
without WASM.

## How it works

The timeline talks to an **adaptive controller** with two methods — a synchronous
`start(context)` (the first design comes from JS prior draws while the WASM loads in
the background) and an async `update(trial_data)` — each returning the next design
plus the current posterior. Swapping the deterministic mock controller for the
in-browser Stan controller is the entire abstraction; the timeline never sees Stan or
WASM. Scheduling rides on jsPsych 8: the response trial's `on_finish` is composed
with the controller update and awaited, so the next trial can't render until the next
design is ready — no hidden plugin trials are injected.

- **`src/ado/mi_engine.js`** — model-agnostic mutual-information design selection.
- **`src/ado/stan_worker.js`** — one generic Web Worker that runs NUTS off the main thread.
- **`src/ado/ado_timeline.js`** — the generic, stimulus-agnostic timeline.
- **`src/controllers/`** — the in-browser Stan controller and the mock controller.
- **`src/index.js`** — the `jsPsychADO` façade (`createController`).

## Repository layout

- **`src/`** — the general, model- and stimulus-agnostic library (engine,
  worker, controllers, generic timeline, façade). It knows nothing about any task.
- **`src/models/<name>/`** — a pluggable model package: a `model.js` adapter
  (`params`, `prior`, `responseProb` or `responseProbs`, `stanData`, …) plus its
  compiled `.stan` artifacts. Shipped models: `hyperbolic` (delay discounting),
  `weber_dots` (ANS acuity), `line_length_discrimination_3ifc` (3-way categorical),
  `magnitude_estimation` (continuous; Stevens' power law).
- **`demos/<name>/`** — example pages that pair a model with user-authored task
  code (design grid + jsPsych trials, kept demo-local); see
  [`demos/README.md`](demos/README.md). The `demos/byo_model_exponential/` demo even
  authors its own model (exponential discounting) in-folder. These are how-to
  examples, not part of the published library.

## Adding tasks and models

A **task** is your experiment code: a design grid plus ordinary jsPsych trials wired
to a controller handle — nothing to register or package. A **model** is a package
under `src/models/<name>/` (or authored locally, like the BYO demo); the engine,
controller, and timeline stay generic. Model compilation steps are in
[src/models/README.md](src/models/README.md). For runnable end-to-end walkthroughs,
see the **bring-your-own-task** and **bring-your-own-model** demos in
[`demos/README.md`](demos/README.md).
Binary models expose `responseProb(design, params) -> P(response = 1)`.
Finite categorical models expose `responseProbs(design, params) -> [p0, p1, ...]`.
Continuous models expose a response density `responseDensity(design, params, y)` (plus
moments/entropy/sampler); see the [models README](src/models/README.md).

## Development

```bash
node --test tests/js/*.test.mjs        # unit tests: MI engine, model adapter, façade, controller + timeline failure paths
node tests/js/stan_recovery.smoke.mjs  # real-WASM smoke: ADO recovers parameters (hyperbolic)
node tests/js/weber_recovery.smoke.mjs # real-WASM smoke: recovers the Weber/ANS model
node tests/js/line_length_3ifc_recovery.smoke.mjs # real-WASM smoke: recovers a 3-param categorical model
node tests/js/magnitude_estimation_recovery.smoke.mjs # real-WASM smoke: recovers the Stevens exponent (continuous)
node tests/js/exponential_recovery.smoke.mjs # real-WASM smoke: recovers the BYO-model demo's authored model
node tests/js/likelihood_parity.smoke.mjs # real-WASM smoke: JS responseProb == compiled Stan, + fixed-seed determinism
node tests/js/stopping_recovery.smoke.mjs # real-WASM smoke: EIG-fraction adaptive stopping
node tests/js/locate_file.smoke.mjs    # real-WASM smoke: emscripten honors the wasm locateFile patch
npm install && npm run test:browser    # headless Worker/WASM browser smokes (puppeteer)
npm run test:bundler                   # npm pack -> Vite build -> headless: hashed WASM loads
npm run patch:wasm                     # re-apply the bundler-safety glue patch after recompiling a model
```

The `likelihood_parity` smoke is a correctness guard: every `.stan` exposes its
per-trial choice probability as a transformed/generated quantity, so it checks the
JS `responseProb`/`responseProbs` (used by the MI engine **and** the simulator)
against the compiled Stan likelihood draw-for-draw — if the two ever diverge, ADO
would optimize designs against the wrong model. (The Weber model's JS `Phi` is an
erf approximation, so its parity bound is `2e-6`, not machine epsilon.)

CI runs the unit tests, the recovery + locateFile smokes, the headless browser
smoke, and the bundler smoke on every PR and push to `main`. After recompiling any
model's `main.js`, run `npm run patch:wasm` (CI's unit job fails if a committed
`main.js` is left unpatched).

Releases publish to npm by pushing a `vX.Y.Z` tag, which triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml) to re-run the full
gates and `npm publish --provenance`. See [RELEASING.md](RELEASING.md) and the
[CHANGELOG](CHANGELOG.md).

## Deploying

Serve a demo page such as `demos/delay_discounting/index.html` or
`demos/line_length_discrimination/index.html` from any static host — no backend.
The experiment code, the compiled WASM model, and the vendored sampler
(`core/tinystan/`) are local static assets; the demos load jsPsych and its plugins
from a pinned CDN (unpkg), so a deployment needs network access for those. For a
fully self-contained / offline build, install jsPsych from npm and bundle it (see
[Using with a bundler](#using-with-a-bundler)).

## Compatibility

Browser/Web-Worker only — the WASM is built with emscripten `-sENVIRONMENT=web,worker`.
Requires jsPsych ≥ 8 (`jspsych` is a `peerDependency`, `>=8`) — the adaptive
scheduling relies on v8 awaiting async trial `on_finish` callbacks; the in-repo demos
pin jsPsych 8.2.3 + v2 plugins from a CDN. Development and CI use Node `>=20`.

## Citation

A JOSS paper is in preparation (see [`paper/`](paper/)). Until it is published, please
cite this repository.

## License

[MIT](LICENSE) © The jspsych-ado contributors.
