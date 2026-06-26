// Runtime proof that the #57 glue patch works: emscripten must actually call
// Module.locateFile to resolve the wasm. We simulate a bundler by serving the wasm
// bytes ONLY at a hashed URL and 404-ing the default sibling "main.wasm":
//
//   - WITH a locateFile override pointing at the hashed URL  -> StanModel.load succeeds
//   - WITHOUT the override (default findWasmBinary -> sibling) -> StanModel.load fails
//
// The first proves the PATCHED glue honors Module.locateFile (a regression where the
// patch lands but is dead code would make this fail); the second proves the override
// is actually required under a bundler (the bug #57 fixed). This loads the web-only
// emscripten module in node via a fetch shim, like the recovery smokes, so it is NOT
// part of `node --test`.
//
// Run:  node tests/js/locate_file.smoke.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listModelMains } from "../../scripts/patch-wasm-glue.mjs";

globalThis.window = globalThis.window || {};
const realFetch = globalThis.fetch;

// A bundler-like fetch: serve the model's wasm bytes only when requested at the
// hashed URL; everything else (notably the unhashed sibling) 404s.
let WASM_BYTES = null;
let HASHED_URL = null;
globalThis.fetch = async (url, opts) => {
  const s = url.toString();
  if (s === HASHED_URL && WASM_BYTES) {
    return {
      ok: true,
      status: 200,
      url: s,
      arrayBuffer: async () =>
        WASM_BYTES.buffer.slice(
          WASM_BYTES.byteOffset,
          WASM_BYTES.byteOffset + WASM_BYTES.byteLength,
        ),
    };
  }
  if (s.startsWith("file:")) {
    return {
      ok: false,
      status: 404,
      url: s,
      arrayBuffer: async () => {
        throw new Error("404");
      },
    };
  }
  return realFetch(url, opts);
};

const StanModel = (await import("../../core/tinystan/index.mjs")).default;

let failures = 0;
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

for (const { name, dir } of await listModelMains()) {
  const model = (await import(join(dir, "model.js"))).default;
  WASM_BYTES = await readFile(join(dir, "main.wasm"));
  // A plausibly bundler-hashed URL that is NOT the sibling main.wasm.
  HASHED_URL = new URL(`./main.${name}.deadbeef.wasm`, `file://${dir}/`).href;

  const createModule = (await import(model.moduleUrl)).default;

  // (1) WITH override -> load succeeds.
  let loadedWith = false;
  try {
    const m = await StanModel.load(
      (options) =>
        createModule({ ...options, locateFile: (p) => (p.endsWith(".wasm") ? HASHED_URL : p) }),
      () => {},
    );
    loadedWith = !!m && typeof m.stanVersion === "function";
  } catch (e) {
    console.log(`  [${name}] FAIL: load with locateFile override threw: ${e.message}`);
  }
  if (loadedWith) {
    console.log(`  [${name}] PASS: load succeeded with locateFile -> hashed wasm`);
  } else {
    console.log(`  [${name}] FAIL: load did not succeed with the locateFile override`);
    failures++;
  }

  // (2) WITHOUT override -> default findWasmBinary fetches the sibling, which 404s.
  let loadedWithout = false;
  try {
    const m = await StanModel.load(
      (options) => createModule({ ...options }),
      () => {},
    );
    loadedWithout = !!m && typeof m.stanVersion === "function";
  } catch {
    // expected
  }
  if (!loadedWithout) {
    console.log(
      `  [${name}] PASS: load failed without the override (sibling wasm 404s under a bundler)`,
    );
  } else {
    console.log(`  [${name}] FAIL: load unexpectedly succeeded without a locateFile override`);
    failures++;
  }
}

console.log(
  failures === 0
    ? "\nPASS: emscripten honors Module.locateFile for every model"
    : `\nFAIL: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
