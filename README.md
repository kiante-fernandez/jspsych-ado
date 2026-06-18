<p align="center">
  <img src="https://raw.githubusercontent.com/githubpsyche/jspsych-ado/main/jspsych-ado.png" alt="jspsych-ado — the adaptive loop: model → design → stimulus → response → update" width="180">
</p>

<h1 align="center">jspsych-ado</h1>

<p align="center"><strong>Adaptive design optimization (ADO), entirely in the browser, for jsPsych experiments.</strong></p>

<p align="center">
  <a href="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml">
    <img src="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>

## Overview

After each trial or a set of trials, a Stan model is compiled to WebAssembly and run in a Web Worker via
[tinystan](https://github.com/WardBrian/tinystan), which estimates the posterior over your
model's parameters; the next design is chosen by maximizing **mutual information**
over a candidate design grid. There is **no server and no Python**: everything runs
client-side, so an experiment deploys as static assets.

You bring a **task** (design grid + presentation) and a **model** (Stan likelihood +
small JS adapter); `jsPsychADO` checks that they are compatible and turns them into
an adaptive jsPsych timeline. Alternatively, you may use one of our models that we 
have written, which are ready to be used out of the box.

## Status

🚧 **In active development, preparing the first npm release.** The in-browser
engine, the binary delay-discounting example, the 3IFC categorical line-length
example, and the Halberda-style dot comparison example work and are covered by CI
(unit tests + real headless Worker/WASM smokes). The committed WASM is now
bundler-safe and the package builds under Vite and webpack 5 (see
[Using with a bundler](#using-with-a-bundler) and
[#57](https://github.com/githubpsyche/jspsych-ado/issues/57)). Still settling: the
experiment API around future task/model/controller extensions. Not yet published to
npm — for now, either serve the repo (above) or install from a packed tarball / git.

## Quick start

No build step — serve the repo with any static server (VS Code Live Server, etc.) and
open the example:

```text
experiments/delay_discounting/index.html?controller=stan&strategy=ado&debug=1
experiments/line_length_discrimination/index.html?controller=stan&strategy=ado&debug=1
experiments/experiment_halberda_dot_comparison/index.html?controller=mock&debug=1
```

- `controller=stan` (default) — live in-browser Stan inference; `controller=mock` — a
  deterministic, no-WASM controller for fast UI work.
- `strategy=ado` (default) — MI-optimal designs; `strategy=random` — a random baseline
  drawn from the same grid.
- `debug=1` — per-trial console summary, selection diagnostics when available,
  and live posterior-convergence charts.
- `simulate=data-only` | `simulate=visual` — run a simulated participant.
  Data-only simulation stays fast for validation; visual simulation uses slower
  shared timing defaults so the stimulus, response, and debug updates are
  watchable.

## Usage

An experiment is a thin consumer: register a task package and a model package, then
ask the façade for the timeline. The example below is for a **bundler** project
(`npm install jspsych-ado`); see [Using with a bundler](#using-with-a-bundler) for
the required setup, and [Quick start](#quick-start) above for running the in-repo
examples by serving the repo statically.

```js
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";
import callFunction from "@jspsych/plugin-call-function";

import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";
import delayDiscountingTask from "jspsych-ado/tasks/delay_discounting/task.js";
import "jspsych-ado/tasks/delay_discounting/task.css"; // task styles (see Tasks)

const jsPsych = initJsPsych();

jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(hyperbolic, {
  stan:     { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 },
  n_trials: 42,
});

const ado = jsPsychADO.createTimeline(jsPsych, {
  task:  delayDiscountingTask.id,
  model: hyperbolic.id,
  // Inject the jsPsych plugin classes the timeline builds trials from. A static
  // page that loads the plugins' UMD <script> builds can omit this — the timeline
  // falls back to the globals those scripts define.
  plugins: { htmlButtonResponse, callFunction },
});
jsPsych.run([ /* instructions, */ ...ado /*, end screen */ ]);
```

### Using with a bundler

The package is ESM and runs **client-side only** (it spawns a Web Worker that loads
the Stan WASM). It is tested against Vite and webpack 5.

- **jsPsych plugins.** Install the plugins your task uses and pass them via
  `createTimeline(..., { plugins })`: `@jspsych/plugin-html-button-response` and
  `@jspsych/plugin-call-function` for button tasks (delay discounting, line length),
  plus `@jspsych/plugin-canvas-keyboard-response` for canvas tasks (dots). They are
  declared as optional `peerDependencies`. (On a static page that loads their UMD
  `<script>` builds instead, the timeline reads them from `globalThis` and you can
  omit `plugins`.)
- **Task styles.** Import the task's stylesheet, e.g.
  `import "jspsych-ado/tasks/delay_discounting/task.css"`.
- **Vite.** The worker and WASM are emitted from `new URL(..., import.meta.url)`
  inside the installed dependency. If Vite's dep pre-bundling interferes with that
  emission, exclude the package: `optimizeDeps: { exclude: ["jspsych-ado"] }`.
- **webpack 5.** Works out of the box (first-class `new Worker(new URL(...))` and
  WASM asset support); no extra config needed.
- **SSR / Next.js.** Build the timeline only in the browser (e.g. behind
  `useEffect` / a `"use client"` component) — the Worker and WASM are not available
  during server rendering.

### API

- `registerTask(name, spec)` — register task presentation, design grid, and response labels.
- `registerModel(name, spec)` / `registerModelPackage(model, overrides)` — register a statistical model.
- `prepareModels({ compileServer })` — compile any models registered from Stan source.
- `createTimeline(jsPsych, { task, model, ... }, run_context)` — validate and build the adaptive timeline fragment.

### Debug traces

`debug=1` prints a readable console summary after each adaptive update — the design
presented, the response, posterior mean/sd for the active model parameters, the next
selected design, and the local sampling time. In DevTools each summary also has a
collapsed details group with tables.

With `controller=stan`, debug output also includes posterior draw histograms and an
on-page information-gain panel. The panel plots the mutual information of the design
that was actually selected on each trial plus realized information gain after the
response. Under `strategy=ado`, the selected-design MI is the max-MI design by
construction; under `strategy=random`, it is the MI of the randomly sampled design,
so it should not be read as an optimality claim. The fast `controller=mock` path does
not fabricate these quantitative validation metrics; it remains for timeline/UI smoke
testing without WASM.

## How it works

The timeline talks to an **adaptive controller** with two async methods —
`start(context)` and `update(trial_data)` — each returning the next design plus the
current posterior. Swapping the deterministic mock controller for the in-browser Stan
controller is the entire abstraction; the timeline never sees Stan or WASM.

- **`jspsych-ado/ado/mi_engine.js`** — model-agnostic mutual-information design selection.
- **`jspsych-ado/ado/stan_worker.js`** — one generic Web Worker that runs NUTS off the main thread.
- **`jspsych-ado/ado/ado_timeline.js`** — the generic, stimulus-agnostic timeline.
- **`jspsych-ado/ado/experiment_shell.js`** — shared experiment-page run-mode and simulation wiring.
- **`jspsych-ado/controllers/`** — the in-browser Stan controller and the mock controller.
- **`jspsych-ado/index.js`** — the `jsPsychADO` façade.

## Repository layout

- **`jspsych-ado/`** — the general, model- and stimulus-agnostic library (engine,
  worker, controllers, generic timeline, façade). It knows nothing about any task.
- **`jspsych-ado/tasks/<name>/`** — a pluggable task package: design grid,
  presentation, choices, response labels, and response mapping.
- **`jspsych-ado/models/<name>/`** — a pluggable model package: a `model.js` adapter
  (`params`, `prior`, `responseProb` or `responseProbs`, `buildData`, …) plus its
  compiled `.stan` artifacts.
- **`experiments/<name>/`** — thin consumers; current examples are
  `experiments/delay_discounting/`, `experiments/line_length_discrimination/`,
  and `experiments/experiment_halberda_dot_comparison/`.

## Adding tasks and models

Drop task packages under `jspsych-ado/tasks/<name>/` and model packages under
`jspsych-ado/models/<name>/`. The engine, controller, and timeline stay generic.
Model compilation steps are in [jspsych-ado/models/README.md](jspsych-ado/models/README.md);
the task package contract is in [jspsych-ado/tasks/README.md](jspsych-ado/tasks/README.md).
Binary models expose `responseProb(design, params) -> P(response = 1)`.
Finite categorical models expose `responseProbs(design, params) -> [p0, p1, ...]`.
Continuous responses are not supported yet.

## Development

```bash
node --test tests/js/*.test.mjs        # unit tests: MI engine, model adapter, façade
node tests/js/stan_recovery.smoke.mjs  # real-WASM smoke: ADO recovers parameters
node tests/js/locate_file.smoke.mjs    # real-WASM smoke: emscripten honors the wasm locateFile patch
npm install && npm run test:browser    # headless Worker/WASM browser smoke (puppeteer)
npm run test:bundler                   # npm pack -> Vite build -> headless: hashed WASM loads
npm run patch:wasm                     # re-apply the bundler-safety glue patch after recompiling a model
```

CI runs the unit tests, the recovery + locateFile smokes, the headless browser
smoke, and the bundler smoke on every PR. After recompiling any model's `main.js`,
run `npm run patch:wasm` (CI's unit job fails if a committed `main.js` is left
unpatched).

## Deploying

Serve an experiment page such as
`experiments/delay_discounting/index.html` or
`experiments/line_length_discrimination/index.html`. The experiment, the WASM
model, and the vendored sampler are all static assets, so the build runs with no
backend.

## Compatibility

Browser/Web-Worker only — the WASM is built with emscripten `-sENVIRONMENT=web,worker`.
Built against the minimal vendored jsPsych runtime in `core/jspsych/`
(jsPsych 7-era plugin API). Add jsPsych plugins there only when maintained demos
actually load them.

## Citation

A JOSS paper is in preparation (see [`paper/`](paper/)). Until it is published, please
cite this repository.

## License

[MIT](LICENSE) © The jspsych-ado contributors.
