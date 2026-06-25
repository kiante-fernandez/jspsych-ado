import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins the package's PUBLIC export surface so a future change can't silently re-widen
// it. The supported surface is the façade entry plus the model/task package subpaths;
// the engine, controllers, and vendored tinystan are internal (reachable only via the
// package's own relative imports, not as consumer-facing subpaths).
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("package exports are exactly the curated public surface", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const keys = Object.keys(pkg.exports).sort();
  assert.deepEqual(keys, [".", "./models/*", "./package.json", "./tasks/*"]);
});

test("internal subpaths are NOT re-exposed as public exports", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  for (const internal of ["./ado/*", "./controllers/*", "./core/tinystan/*"]) {
    assert.ok(!(internal in pkg.exports), `${internal} must stay internal, not a public export subpath`);
  }
});
