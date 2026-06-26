// Real-bundler smoke for the #57 packaging story. Packs the library, installs the
// tarball into tests/bundler/fixture (a Vite consumer using the PUBLIC API with
// plugin injection), runs a production build, serves the output, and headlessly
// confirms:
//   - the wasm asset is emitted with a HASHED name (so the static-sibling lookup
//     would 404 — the locateFile path is the only thing that can work)
//   - the page loads it with NO failed .wasm request and produces a posterior
//
// This is the only check that exercises the fix end-to-end through a real bundler;
// the node tests bypass the Worker and the browser smokes serve raw source.
//
// Run:  node tests/bundler/run.mjs        (npm run test:bundler)

import { execFileSync } from "node:child_process";
import { readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const FIXTURE = join(HERE, "fixture");
const DIST = join(FIXTURE, "dist");

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
  });

function fail(msg) {
  console.error("\nFAIL: " + msg);
  process.exit(1);
}

// 1. Pack the library.
console.log("== npm pack ==");
const packOut = execFileSync("npm", ["pack", "--silent"], { cwd: ROOT }).toString().trim();
const tarball = join(ROOT, packOut.split("\n").pop().trim());
if (!existsSync(tarball)) fail("npm pack did not produce a tarball: " + tarball);
console.log("packed: " + tarball);

try {
  // 2. Install fixture deps + the freshly packed tarball.
  console.log("\n== install fixture deps + tarball ==");
  run("npm", ["install", "--no-audit", "--no-fund"], FIXTURE);
  run("npm", ["install", "--no-audit", "--no-fund", "--no-save", tarball], FIXTURE);

  // 3. Production build.
  console.log("\n== vite build ==");
  await rm(DIST, { recursive: true, force: true });
  run("npx", ["vite", "build"], FIXTURE);

  // 4. Confirm a HASHED wasm asset was emitted (proves the static-sibling lookup
  //    would 404, so only the locateFile->wasmUrl path can work).
  const assets = await readdir(join(DIST, "assets")).catch(() => []);
  const wasm = assets.find((f) => f.endsWith(".wasm"));
  const worker = assets.find((f) => /worker.*\.js$/i.test(f) || /stan_worker/i.test(f));
  if (!wasm) fail("no .wasm asset emitted by the bundler (dist/assets): " + assets.join(", "));
  if (!/main[.-][a-z0-9]+\.wasm$/i.test(wasm) || wasm === "main.wasm") {
    fail("wasm asset is not hashed (so this would not exercise the fix): " + wasm);
  }
  console.log(`emitted hashed wasm: ${wasm}` + (worker ? `, worker chunk: ${worker}` : ""));

  // 5. Serve dist + headless-load.
  const result = await headlessRun(DIST);
  console.log("\n== headless result ==");
  console.log(JSON.stringify(result, null, 2));

  const ok =
    result.spike &&
    result.spike.done === true &&
    Array.isArray(result.spike.post_mean_k) &&
    result.spike.post_mean_k.length > 0 &&
    result.spike.post_mean_k.every((v) => typeof v === "number" && isFinite(v)) &&
    result.failedWasm.length === 0;

  if (!ok) {
    if (result.spike && result.spike.error) console.error("page error:\n" + result.spike.error);
    if (result.failedWasm.length)
      console.error("failed wasm requests:\n" + result.failedWasm.join("\n"));
    fail("bundled consumer did not load the hashed wasm + produce a posterior");
  }
  console.log(
    "\nPASS: packed library builds under Vite and loads its hashed WASM through the public API",
  );
} finally {
  await rm(tarball, { force: true });
}

async function headlessRun(dist) {
  const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".css": "text/css",
  };
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(req.url.split("?")[0]);
    if (path === "/") path = "/index.html";
    try {
      const body = await readFile(join(dist, path));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const { default: puppeteer } = await import(
    join(ROOT, "node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js")
  );
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const failedWasm = [];
  page.on("requestfailed", (r) => {
    if (r.url().includes(".wasm"))
      failedWasm.push(r.url() + " :: " + (r.failure()?.errorText || ""));
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes(".wasm")) failedWasm.push(r.status() + " " + r.url());
  });

  let spike, urls;
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(
      "window.__spike && (window.__spike.done === true || window.__spike.error)",
      { timeout: 60000 },
    );
  } catch (e) {
    spike = await page.evaluate(() => window.__spike).catch(() => ({ error: String(e) }));
  }
  spike = spike || (await page.evaluate(() => window.__spike));
  urls = await page.evaluate(() => window.__urls).catch(() => null);

  await browser.close();
  server.close();
  return { spike, urls, failedWasm };
}
