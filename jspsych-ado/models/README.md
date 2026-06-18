# Models

Each subfolder is a self-contained statistical model package the in-browser ADO
controller can run. Models are task-agnostic: they define parameters, priors,
likelihood, and Stan data, while task packages define design grids, presentation,
choices, and response labels.

A package contains:

| File | What it is |
| --- | --- |
| `<name>.stan` | the Stan model (source of truth for the likelihood + priors) |
| `main.js` + `main.wasm` | the compiled WebAssembly model (committed) |
| `model.js` | the JS adapter the engine talks to |

`model.js` exports a default object:

```js
{
  id,             // string id, saved into the data
  params,         // parameter names to summarize, e.g. ["k", "tau"]
  designKeys,     // design fields consumed by responseProb/responseProbs/buildData
  responseSpace,  // {type:"binary"} or {type:"categorical", n_categories}
  prior,          // { param: {dist:"lognormal"|"normal"|"halfnormal", ...} }
  posterior_display, // optional per-param chart labels, preferred ranges, true bounds
  moduleUrl,      // new URL("./main.js", import.meta.url).href
  wasmUrl,        // new URL("./main.wasm", import.meta.url).href (so bundlers emit the wasm; see #57 below)
  buildData,      // (trials) => Stan data block
  responseProb,   // binary: (design, paramDraw) => P(outcome = 1)
  responseProbs,  // categorical: (design, paramDraw) => [p0, p1, ...]
}
```

The JS likelihood is the mirror of the `.stan` likelihood used for fast
mutual-information design selection. Binary models may expose `responseProb`;
finite categorical models expose `responseProbs`. Probability vectors must be
finite, nonnegative, in response-index order, and sum to 1. Continuous-response
models are out of scope for the current engine.

`posterior_display.y_min` and `posterior_display.y_max` are preferred/fallback
debug-chart ranges, not hard parameter bounds. Use `lower_bound` or `upper_bound`
only for true model constraints, and `min_y_span` to prevent over-zoomed axes.

`designKeys` and `responseSpace` let `createTimeline({ task, model })` reject
incompatible combinations before a participant sees the task.

## Compiling a model (no local toolchain)

There is no in-browser Stan compilation, but you never need Docker or emscripten
locally. Send the `.stan` to the public stan-playground compile server and download
the artifacts (keep the `main.js` / `main.wasm` names — without a bundler the glue
resolves `main.wasm` as a sibling of `main.js`; under a bundler the
[patch below](#after-recompiling-apply-the-bundler-safety-patch-57) routes it through
the model's `wasmUrl` instead):

```bash
cd jspsych-ado/models/<name>
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @<name>.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

Or use the web app at https://stan-playground.flatironinstitute.org. If you prefer
a local server, run `docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest`
and point the URLs at `http://localhost:8083`.

The compiled module is web/worker-only (`-sENVIRONMENT=web`); it runs in the
browser and Web Worker, not in plain Node.

> **Committing the artifacts is the production path.** You can also register a model
> from Stan source (`registerModel({ stanCode | stanUrl, ... })` + `prepareModels`),
> which compiles on the stan-playground server at run time and points `moduleUrl` at
> the server's `main.js`. That model's wasm is then fetched cross-origin from the
> compile server, so the server must send `Access-Control-Allow-Origin` and the
> correct `application/wasm` MIME — and the run depends on that server being up. For
> a deployable study, prefer committing `main.js` + `main.wasm` and registering with
> `registerModelPackage` (self-contained, bundler-safe via `wasmUrl`).

### After (re)compiling: apply the bundler-safety patch (#57)

The stan-playground toolchain builds with `-sINCOMING_MODULE_JS_API=print,printErr`,
so the generated `main.js` ignores `Module.locateFile` and resolves its `.wasm` as an
unhashed sibling — which works when served statically but 404s once a bundler
(Vite/webpack) hashes the emitted `.wasm`. So after downloading a fresh `main.js`,
re-run the one-line patch (from the repo root; it patches every model and is
idempotent):

```bash
node scripts/patch-wasm-glue.mjs
```

This makes `main.js` honor `Module.locateFile`, which the worker feeds the model's
bundler-emitted `wasmUrl` (`new URL("./main.wasm", import.meta.url)` in `model.js`).
`tests/js/wasm_glue_patch.test.mjs` fails in CI if any committed `main.js` is left
unpatched, so this can't be forgotten silently.

## Adding a new model

1. Write `jspsych-ado/models/<name>/<name>.stan`.
2. Compile it and drop `main.js` + `main.wasm` in the folder.
3. Run `npm run patch:wasm` so the fresh `main.js` honors `Module.locateFile`
   (CI fails otherwise — see the bundler-safety patch above).
4. Write `jspsych-ado/models/<name>/model.js` with `params`, `designKeys`,
   `responseSpace`, priors matching the `.stan`, `buildData`, the matching
   likelihood function (`responseProb` for binary or `responseProbs` for finite
   categorical responses), `moduleUrl: new URL("./main.js", import.meta.url).href`,
   and `wasmUrl: new URL("./main.wasm", import.meta.url).href` (so bundlers emit
   the wasm).
5. Add `tests/js/<name>.test.mjs`.
6. Register it from an experiment page with `jsPsychADO.registerModelPackage(model)`.

The engine, worker, controller, simulator, and timeline are parameter- and
stimulus-agnostic. Posterior export/debug fields are derived from model parameter
names (`post_mean_<param>`, `sim_<param>`), while the stimulus comes from the
registered task.
