# Provenance: `main.js` / `main.wasm`

Compiled from `weber_dot_comparison.stan` (this folder) and committed so the model
runs as pure static assets — no compile step at run time.

- **Source:** `weber_dot_comparison.stan` — the Weber/ANS numerosity-discrimination
  model from PR #39 (@xiaohong-cai), unchanged.
- **Compiler:** stan-playground compile server, <https://stan-wasm.flatironinstitute.org>
- **Target:** emscripten `-sENVIRONMENT=web,worker` — browser / Web Worker only, not
  plain Node (the recovery smoke shims `fetch` to load it under Node)
- **Artifact names:** kept as `main.js` + `main.wasm` (`main.js` hardcodes its sibling
  `main.wasm`); do not rename.

## Regenerate

```bash
cd jspsych-ado/models/weber_dots
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @weber_dot_comparison.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

After regenerating, run `node tests/js/weber_recovery.smoke.mjs` to confirm the model
loads and recovers `w`.
