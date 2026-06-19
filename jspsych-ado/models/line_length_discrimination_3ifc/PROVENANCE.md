# Provenance: `main.js` / `main.wasm`

These artifacts are compiled from `line_length_discrimination_3ifc.stan` in this
folder and committed so the adaptive demo runs as pure static assets.

- **Source:** `line_length_discrimination_3ifc.stan`
- **Compiler:** stan-playground compile server, <https://stan-wasm.flatironinstitute.org>
- **Compiled model id:** `6a70a5912ce409d4d1967459fb4d20bbf2b8e500`
- **Target:** emscripten `-sENVIRONMENT=web,worker` -- runs in the browser / Web Worker
- **Artifact names:** kept as `main.js` + `main.wasm` because `main.js` loads its
  sibling `main.wasm`

## Regenerate

```bash
cd jspsych-ado/models/line_length_discrimination_3ifc
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @line_length_discrimination_3ifc.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```
