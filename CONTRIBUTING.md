# Contributing to jspsych-ado

First off, thank you for taking the time to contribute. Contributions from users and developers help make browser-based adaptive experiments easier to build, test, and reuse.

All types of contributions are welcome: from reporting bugs and improving documentation to adding examples, tests, tasks, models, or improvements to the adaptive engine.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [Issues](https://github.com/kiante-fernandez/jspsych-ado/issues) tab to see if the problem has already been reported.

When filing an issue, please include:

- The package version or commit you are using.
- A minimal example or set of steps that reproduces the problem.
- Any error message, console output, or failed test output, if applicable.

### Suggesting Enhancements

If you have an idea for a new feature, such as a new task, model, controller option, or demo:

1. Open an issue to discuss it first.
2. Provide a clear description of the use case and how it would benefit the package.

### Pull Requests (PRs)

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: Run `npm install`.
3. **Implement changes**: Ensure your code follows the existing style.
4. **Add tests**: If you add or change behavior, add or update the relevant tests.
5. **Run tests**: Ensure the relevant checks pass, for example:

   ```bash
   npm test
   ```

6. **Submit**: Open a PR with a concise title and a description of your changes.

## Project Structure

`jspsych-ado` accepts contributions in a few different areas:

- **Core package** changes affect the adaptive engine, controllers, timeline construction, or public API.
- **Tasks and models** are reusable packages under `src/tasks/` and `src/models/`.
- **Demos** are example pages under `demos/` that show how to use or extend the package.

For task, model, or demo contributions, start with the relevant README:

- [tasks README](src/tasks/README.md)
- [models README](src/models/README.md)
- [demos README](demos/README.md)

### Architecture at a glance

The library is organized around a single coupling point — the **controller contract**:

- `src/index.js` — the public **facade**: `registerTask`, `registerModel` / `registerModelPackage`, `prepareModels`, `createTimeline`.
- `src/controllers/` — an adaptive **controller** exposing two async methods, `start(context)` and `update(trial_data)`. This `start`/`update` contract is the _only_ coupling between the timeline and inference, so `stan_ado_controller.js` (live; Stan compiled to WASM, run in a Web Worker) and `mock_ado_controller.js` (no-WASM dev) are interchangeable behind it.
- `src/ado/` — the model- and task-agnostic engine: mutual-information design selection (`mi_engine.js`), the Stan Web Worker (`stan_worker.js`), the generic timeline (`ado_timeline.js`), early stopping (`stopping.js`), and the simulated participant (`ado_simulation.js`).
- `src/tasks/<name>/` and `src/models/<name>/` — pluggable **task** (presentation, design grid, response coding) and **model** (parameters, prior, likelihood, Stan data + compiled artifacts) packages.
- `demos/` — runnable example pages (not part of the published library).

### Two ways to build the timeline

- **Library consumers** call `jsPsychADO.createTimeline(jsPsych, { task, model, ... })` — the documented public API.
- **The demo pages** call `createExperimentAdoTimeline(...)` from `demos/_shared/experiment_shell.js`, which wraps `createTimeline` and adds URL-driven controller/strategy switching and simulation. That shell is demo scaffolding — your own experiment should call `createTimeline` directly.

---

## Coding Standards

To keep the codebase maintainable, please keep the following in mind:

- **Task/model boundaries**: Tasks define presentation, design grids, and response coding. Models define likelihoods, priors, Stan data, compiled Stan artifacts, and response probabilities.
- **Browser-first examples**: Keep demos and examples runnable as static browser pages unless there is a clear reason to require a bundler.
- **Public behavior**: When changing public API behavior, update the relevant tests, documentation, or examples.

## Working with Stan and WASM (the carve-outs)

Stan compiled to WebAssembly is the core inference engine, and it shapes a few
deliberate departures from the typical jsPsych package conventions. If something here
looks non-idiomatic, this is usually why:

- **No build step, no `@jspsych/config`, no TypeScript.** The library is plain ES
  modules served as-is. It ships committed `.wasm` and runs Stan in a Web Worker, and
  `@jspsych/config`'s Rollup setup cannot emit a Web Worker or hash/emit a `.wasm`
  asset. So instead of a `src/` → `dist/` build, the source under `src/` _is_ what
  ships. Consumers who bundle (Vite/webpack) get correct asset emission via each
  model's `new URL("./main.{js,wasm}", import.meta.url)` (see the `#57` notes).
- **Compiling a model is offline + committed.** There is no in-browser compilation,
  and the public compile server blocks browser cross-origin requests, so you compile a
  `.stan` once (stan-playground server, local Docker, or the web app) and commit
  `main.js` + `main.wasm`. The full recipe lives in [src/models/README.md](src/models/README.md).
- **Re-run `npm run patch:wasm` after (re)compiling a model.** The compile toolchain
  emits glue that ignores `Module.locateFile`; the patch makes it honor the
  bundler-hashed `wasmUrl`. CI fails if any committed `main.js` is left unpatched.
- **Each model package documents provenance.** Add/update a `PROVENANCE.md` recording
  how that model's `main.js`/`main.wasm` were produced (source, server/toolchain, date)
  so the committed binaries are auditable.
- **tinystan is vendored.** The sampler glue under `core/tinystan/` is vendored from
  [WardBrian/tinystan](https://github.com/WardBrian/tinystan) (BSD-3-Clause); keep its
  upstream license header intact when updating it.

### Testing layers

Changes should pass the relevant layer(s):

- `npm test` — Node unit tests (engine, models, controllers, stopping, timeline, URL
  parsing). The fast inner loop; no WASM.
- `npm run test:smoke` — real-WASM parameter-recovery smokes that load the web-only
  WASM in Node and **bypass the Web Worker**.
- `npm run test:browser` — Puppeteer end-to-end smokes that exercise the real Web
  Worker path on the demo pages.
- `npm run test:bundler` — a Vite build of a small experiment; verifies `.wasm` asset
  emission and `wasmUrl` routing.

The one surface not covered by automated tests is the in-browser Web Worker path under
a live Stan run; after touching the worker, controller, or model glue, sanity-check a
demo manually with `?controller=stan&debug=1` (per-trial console summaries + live
posterior/EIG charts).

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it, maintaining a respectful, inclusive, and professional environment.
