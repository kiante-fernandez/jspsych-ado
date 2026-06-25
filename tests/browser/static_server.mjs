// Tiny dependency-free static file server for browser tests. Serves a directory
// with the content-types ES modules + WebAssembly need. Used by the headless
// browser smoke (and handy for local manual testing).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Start a static server rooted at `root`.
 *
 * @param {string} root - Absolute directory to serve.
 * @param {number} [port=0] - Port (0 = ephemeral, recommended for tests).
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export function startStaticServer(root, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const filePath = normalize(join(root, urlPath));
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const info = await stat(filePath);
      if (info.isDirectory()) {
        res.writeHead(302, { Location: urlPath + "/" }).end();
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({
        url: `http://127.0.0.1:${actual}`,
        port: actual,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
