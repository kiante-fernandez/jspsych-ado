# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the package is pre-1.0, minor versions may include breaking changes to the
task/model/controller extension APIs.

## [Unreleased]

### Added

- Continuous-response support: a model can declare `responseSpace: { type: "continuous" }`
  and supply a response density (plus moments/entropy/sampler); the engine scores designs by
  density-quadrature expected information gain. Ships the `magnitude_estimation` task + model
  (Stevens' power law) and the `canvasSliderChoice` response factory (#114).

### Changed

- Raised the minimum Node to `>=20` (was `>=18`); CI now runs the unit suite + recovery
  smokes on a 20.x/22.x matrix instead of only Node 22.
- Narrowed the package `exports` to the supported public surface: the façade (`.`),
  `./models/*`, `./tasks/*`, and `./package.json`. The `./ado/*`, `./controllers/*`,
  and `./core/tinystan/*` subpaths are no longer importable — they were internal
  engine, controller, and vendored-runtime files, never a supported public API
  (resolves #86). Internal relative imports inside the package are unaffected.
- Renamed the package source directory `jspsych-ado/` to `src/` (idiomatic
  single-package layout). The public `exports` keys are unchanged, so consumer
  deep-imports (`jspsych-ado/models/*`, `jspsych-ado/tasks/*`) still resolve.
- The demo-only experiment shell moved out of the published package to
  `demos/_shared/experiment_shell.js`; the package now ships only the library.

### Removed

- The legacy `ado=stan|mock|random` URL alias (and `allow_legacy_ado`) on the demo
  pages; use the canonical `controller=`/`strategy=` parameters instead.

### Internal

- Restructured large modules into cohesive units with unchanged public behavior:
  `ado_timeline.js` → `+ado/response_trials.js` + `ado/debug/{ado_trial_log,posterior_convergence_charts}.js`;
  `index.js` → `+ado/validation.js` + `models/stan_source.js`; the Stan controller's
  Web Worker transport → `controllers/stan_worker_client.js`, with shared controller
  scaffolding in `controllers/controller_common.js`.

## [0.2.0] - 2026-06-18

### Added

- Adaptive early stopping: a `stopping` config (`eig_fraction` / `min_trials` /
  `max_trials` / `consecutive`) stops the run once the best available next design's
  expected information gain falls below a fraction of the maximum achievable EIG
  (`ln(K)` nats). Recorded per row as `ado_should_stop` / `ado_stop_reason` (#21).
- Declarative `stanData` map on a model adapter, replacing hand-written
  `buildData` for the common case (#81).
- Shared design-grid helpers `arange` / `linspace`, re-exported from the façade (#88).
- Demos restructured to teach the package: "drop-in" examples plus
  bring-your-own-task and bring-your-own-model demos (the latter authors its model
  in-folder), and a `demos/README` guide covering the `tasks/`-vs-`demos/`
  distinction and a plain-jsPsych-vs-ADO contrast (#106, #68, #43).

### Changed

- Demos load jsPsych and its plugins from a pinned CDN; the `experiments/` folder
  was renamed to `demos/` (#90, #98).
- Documentation accuracy passes on the README (#99).

### Removed

- **Quest+ / jsQuestPlus** removed from the mainline package and demos; the
  supported runtime controllers are now `stan`, `stan` with `strategy=random`, and
  `mock` (#103).

### Internal

- Test hardening: controller/timeline failure-path coverage, a JS-vs-compiled-Stan
  likelihood-parity smoke (+ fixed-seed determinism), and real-WASM recovery smokes
  for the 3-parameter categorical model and the exponential demo model (#104, #87, #89).
- Release engineering: committed `package-lock.json` (CI uses `npm ci`), `engines.node`,
  this `CHANGELOG`, and a tag-triggered, fully-gated `npm publish --provenance` workflow.

## [0.1.1] - 2026-06-18

### Fixed

- Expose `"./package.json"` in the package `exports` so tooling/consumers that read
  the manifest (e.g. `require("jspsych-ado/package.json")`) resolve it. No runtime or
  API changes from 0.1.0.

## [0.1.0] - 2026-06-18

First npm release — in-browser adaptive design optimization for jsPsych (Stan
compiled to WebAssembly in a Web Worker, mutual-information design selection, no
server and no Python).

### Added

- Model/task split: `registerTask` + `registerModelPackage` + `createTimeline`,
  proven across delay discounting (binary), Halberda dots (binary correctness), and
  3IFC line length (3-way categorical).
- Bundler-safe committed WASM (Vite + webpack), guarded by a real bundler CI smoke (#57).
- jsPsych plugins injected via config (optional peer dependencies), with a UMD-global
  fallback for static pages.
- Per-task CSS, committed compiled models, and the vendored tinystan sampler.

[Unreleased]: https://github.com/kiante-fernandez/jspsych-ado/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kiante-fernandez/jspsych-ado/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/kiante-fernandez/jspsych-ado/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kiante-fernandez/jspsych-ado/releases/tag/v0.1.0
