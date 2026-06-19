# Provenance: `main.js` / `main.wasm`

These artifacts are compiled from `hyperbolic.stan` (this folder) and committed so
the experiment runs as **pure static assets** — there is no compile step at run time.

- **Source:** `hyperbolic.stan`
- **Compiler:** stan-playground compile server, <https://stan-wasm.flatironinstitute.org>
- **Stan version:** 2.39.0 (as reported by `StanModel.stanVersion()` in the recovery smoke)
- **Target:** emscripten `-sENVIRONMENT=web,worker` — runs in the browser / Web Worker only,
  **not** in plain Node (the recovery smoke shims `fetch` to load it under Node)
- **Artifact names:** kept as `main.js` + `main.wasm` — `main.js` hardcodes loading
  its sibling `main.wasm`, so do not rename them

## Regenerate

```bash
cd jspsych-ado/models/hyperbolic
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @hyperbolic.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

After regenerating, run `node tests/js/stan_recovery.smoke.mjs` to confirm the model
still loads and recovers parameters, and the headless browser smoke
(`node tests/browser/dd_smoke.mjs`) to confirm it loads in the Web Worker.
