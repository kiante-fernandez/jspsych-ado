# Provenance: `main.js` / `main.wasm`

Compiled from `magnitude_estimation.stan` (this folder) and committed so the model
runs as pure static assets — no compile step at run time.

- **Source:** `magnitude_estimation.stan` — Stevens' power law in log-log space
  (`log_y ~ normal(loga + b * log_s, sigma)`); the demo model for continuous
  (slider) magnitude estimation. See issue #110.
- **Compiler:** stan-playground compile server, <https://stan-wasm.flatironinstitute.org>
- **Target:** emscripten `-sENVIRONMENT=web,worker` — browser / Web Worker only, not
  plain Node (the recovery smoke shims `fetch` to load it under Node)
- **Artifact names:** kept as `main.js` + `main.wasm` (`main.js` hardcodes its sibling
  `main.wasm`); do not rename.

## Regenerate

```bash
cd src/models/magnitude_estimation
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @magnitude_estimation.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

After regenerating, run `npm run patch:wasm` (so the glue honors a bundler-emitted
`wasmUrl` via `locateFile`), then `node tests/js/magnitude_estimation_recovery.smoke.mjs`
to confirm the model loads and recovers the Stevens exponent `b`.
