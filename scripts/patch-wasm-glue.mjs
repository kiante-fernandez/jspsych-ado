// Patch the committed emscripten glue (main.js) so it honors Module.locateFile.
//
// Why: the stan-playground compile server builds with
// `-sINCOMING_MODULE_JS_API=print,printErr`, so emscripten does NOT wire
// `Module.locateFile` (or `wasmBinary`/`instantiateWasm`) into the loader. Its
// `findWasmBinary()` checks `Module["locateFile"]` but then calls the *local*
// default `locateFile()` (which returns `scriptDirectory + "main.wasm"`), so the
// wasm is always fetched as an unhashed sibling of main.js. That works when the
// files are served statically, but a bundler (Vite/webpack) renames/hashes the
// emitted wasm, so the sibling lookup 404s.
//
// Fix: make `findWasmBinary()` actually call `Module["locateFile"]("main.wasm")`.
// The model adapter supplies `wasmUrl` (a `new URL("./main.wasm", import.meta.url)`
// the bundler emits + hashes) and the worker injects it via Module.locateFile, so
// after this patch the wasm resolves under any bundler AND when static-served.
//
// This is idempotent and verified by tests/js/wasm_glue_patch.test.mjs (CI fails
// if any committed main.js is unpatched, e.g. after a fresh recompile). Re-run
// this after recompiling a model:  node scripts/patch-wasm-glue.mjs
import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_DIR = join(ROOT, "jspsych-ado", "models");

// Exact unpatched form emitted by the stan-playground toolchain, and its fix.
export const UNPATCHED = 'if(Module["locateFile"]){return locateFile("main.wasm")}';
export const PATCHED = 'if(Module["locateFile"]){return Module["locateFile"]("main.wasm")}';

export function patchSource(source) {
  if (source.includes(PATCHED)) return { changed: false, source };
  // split/join (not String.replace) so PATCHED is inserted literally — replace would
  // interpret any `$` in the replacement as a capture-group token.
  if (source.includes(UNPATCHED)) return { changed: true, source: source.split(UNPATCHED).join(PATCHED) };
  return { changed: false, source, missing: true };
}

/** Every committed model package that has a compiled `main.js`: [{ name, dir, file }].
 *  Shared with the guard test (tests/js/wasm_glue_patch.test.mjs) so both agree on
 *  what to check. */
export async function listModelMains() {
  const entries = await readdir(MODELS_DIR, { withFileTypes: true });
  const mains = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(MODELS_DIR, entry.name);
    const file = join(dir, "main.js");
    try { await access(file); mains.push({ name: entry.name, dir, file }); } catch { /* no compiled wasm in this package */ }
  }
  return mains;
}

async function main() {
  let patched = 0, already = 0, missing = [];
  for (const { name, file } of await listModelMains()) {
    let src;
    // listModelMains already confirmed the file exists, so a read failure here is a
    // real problem (permissions, a racing write) — report it loudly, don't skip.
    try { src = await readFile(file, "utf8"); }
    catch (e) { console.log(`  WARNING: ${name}/main.js could not be read: ${e.message}`); missing.push(name); continue; }
    const { changed, source, missing: unrecognized } = patchSource(src);
    if (changed) { await writeFile(file, source); console.log(`  patched ${name}/main.js`); patched++; }
    else if (unrecognized) { console.log(`  WARNING: ${name}/main.js has neither the patched nor the known unpatched form`); missing.push(name); }
    else { console.log(`  already patched ${name}/main.js`); already++; }
  }
  console.log(`\n${patched} patched, ${already} already patched${missing.length ? `, ${missing.length} unrecognized: ${missing.join(", ")}` : ""}`);
  if (missing.length) process.exitCode = 1;
}

// Run main() only when invoked directly (not when imported by the guard test).
// pathToFileURL handles paths needing URL-encoding (spaces, etc.), which a raw
// `file://${process.argv[1]}` would mismatch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
