# Provenance: `main.js` / `main.wasm`

These artifacts are compiled from `exponential.stan` (this folder) and committed so
the experiment runs as **pure static assets** — there is no compile step at run time.

- **Source:** `exponential.stan`
- **Compiler:** stan-playground compile server, <https://stan-wasm.flatironinstitute.org>
- **Stan version:** 2.39.0 (as reported by `StanModel.stanVersion()` in the recovery smoke)
- **Target:** emscripten `-sENVIRONMENT=web,worker` — runs in the browser / Web Worker only,
  **not** in plain Node (the recovery smoke shims `fetch` to load it under Node)
- **Artifact names:** kept as `main.js` + `main.wasm` — `main.js` hardcodes loading
  its sibling `main.wasm`, so do not rename them
- **Bundler-safety patch:** `main.js` is patched by `npm run patch:wasm` so emscripten
  honors `Module.locateFile` (the #57 fix). Re-run it after regenerating.

## Regenerate

```bash
cd demos/byo_model_exponential
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @exponential.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
cd - && npm run patch:wasm   # re-apply the bundler-safety glue patch
```

After regenerating, run `node tests/js/exponential_recovery.smoke.mjs` to confirm the
model loads and recovers parameters, and `node tests/browser/dd_smoke.mjs` plus the
exponential demo to confirm it loads in the Web Worker.
