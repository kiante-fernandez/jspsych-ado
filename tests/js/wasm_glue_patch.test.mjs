import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { UNPATCHED, PATCHED, listModelMains } from "../../scripts/patch-wasm-glue.mjs";

// Guards the bundler-safety fix (#57). For every committed model:
//  - main.js must be patched so emscripten honors Module.locateFile (the
//    stan-playground toolchain emits the UNPATCHED form, which fetches an unhashed
//    sibling .wasm that 404s under a bundler). Re-run `node scripts/patch-wasm-glue.mjs`
//    after recompiling — this test fails until then, so the regression can't ship.
//  - model.js must expose a wasmUrl, the bundler-emitted .wasm asset URL the worker
//    feeds into locateFile. A new model that omits it would silently break bundling.
const models = await listModelMains();

test("there is at least one committed model to check", () => {
  assert.ok(models.length > 0, "expected compiled model main.js files under jspsych-ado/models/*");
});

for (const { name, dir, file } of models) {
  test(`${name}/main.js honors Module.locateFile (bundler-safe, #57)`, async () => {
    const src = await readFile(file, "utf8");
    assert.ok(
      src.includes(PATCHED),
      `${name}/main.js is missing the locateFile patch — run \`node scripts/patch-wasm-glue.mjs\` after (re)compiling.`
    );
    assert.ok(
      !src.includes(UNPATCHED),
      `${name}/main.js still has the unpatched locateFile form — run \`node scripts/patch-wasm-glue.mjs\`.`
    );
  });

  test(`${name}/model.js declares a wasmUrl (bundler-safe, #57)`, async () => {
    const model = (await import(pathToFileURL(join(dir, "model.js")).href)).default;
    assert.ok(
      model && typeof model === "object",
      `${name}/model.js must have a default export (the model package object).`
    );
    assert.ok(
      typeof model.wasmUrl === "string" && model.wasmUrl.endsWith("main.wasm"),
      `${name}/model.js must expose \`wasmUrl: new URL("./main.wasm", import.meta.url).href\` so bundlers emit the wasm.`
    );
  });
}
