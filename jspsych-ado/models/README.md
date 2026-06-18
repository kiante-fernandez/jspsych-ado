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
  designKeys,     // design fields consumed by responseProb/buildData
  responseSpace,  // currently { type: "binary" }
  prior,          // { param: {dist:"lognormal"|"normal"|"halfnormal", ...} }
  posterior_display, // optional per-param chart labels/ranges for debug charts
  moduleUrl,      // new URL("./main.js", import.meta.url).href
  buildData,      // (trials) => Stan data block
  responseProb,   // (design, paramDraw) => P(outcome = 1)
}
```

`responseProb` is the JS mirror of the `.stan` likelihood used for fast
mutual-information design selection. Keep it and the `.stan` model in agreement;
the adapter unit test (`tests/js/<name>.test.mjs`) guards the formula.

`designKeys` and `responseSpace` let `createTimeline({ task, model })` reject
incompatible combinations before a participant sees the task.

## Compiling a model (no local toolchain)

There is no in-browser Stan compilation, but you never need Docker or emscripten
locally. Send the `.stan` to the public stan-playground compile server and download
the artifacts (keep the `main.js` / `main.wasm` names — `main.js` hardcodes its
sibling `main.wasm`):

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

## Adding a new model

1. Write `jspsych-ado/models/<name>/<name>.stan`.
2. Compile it and drop `main.js` + `main.wasm` in the folder.
3. Write `jspsych-ado/models/<name>/model.js` with `params`, `designKeys`,
   `responseSpace`, priors matching the `.stan`, `buildData`, and `responseProb`.
4. Add `tests/js/<name>.test.mjs`.
5. Register it from an experiment page with `jsPsychADO.registerModelPackage(model)`.

The engine, worker, controller, simulator, and timeline are parameter- and
stimulus-agnostic. Posterior export/debug fields are derived from model parameter
names (`post_mean_<param>`, `sim_<param>`), while the stimulus comes from the
registered task.
