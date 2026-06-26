// Shared Node shim for loading the web-only Stan WASM artifacts outside a browser.
//
// The compiled model glue (main.js) and tinystan are built with `-sENVIRONMENT=web`:
// they expect a browser `window` and fetch `main.wasm` via `fetch()`. The recovery/parity
// smokes run in plain Node and bypass the Web Worker, so they need (1) a minimal `window`
// global and (2) a `fetch` that resolves the `file:` URL the glue requests
// (`new URL("./main.wasm", import.meta.url)`) by reading the file off disk. Importing this
// module installs both as a side effect; static imports run before the importing module's
// top-level `await import(...)`, so the shim is in place before any glue loads. Non-`file:`
// URLs fall through to the real fetch.
//
// NOTE: locate_file.smoke.mjs intentionally does NOT use this — it installs its own fetch to
// exercise the bundler `locateFile` path (serve a hashed wasm, 404 the unhashed sibling).
import { readFile } from "node:fs/promises";

globalThis.window = globalThis.window || {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const s = url.toString();
  if (s.startsWith("file:")) {
    const buf = await readFile(new URL(s));
    return {
      ok: true,
      status: 200,
      url: s,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  }
  return realFetch(url, opts);
};
