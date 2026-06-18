import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BINARY_EXTENSIONS = new Set([".pdf", ".png", ".wasm"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".pytest_cache", "__pycache__"]);

function walkFiles(relative_dir = "") {
  const absolute_dir = resolve(ROOT, relative_dir);
  const files = [];
  for (const entry of readdirSync(absolute_dir, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const relative_path = relative_dir ? `${relative_dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walkFiles(relative_path));
    } else if (entry.isFile()) {
      files.push(relative_path);
    }
  }
  return files.sort();
}

test("maintained demos use only the minimal jsPsych runtime bundle", () => {
  assert.deepEqual(walkFiles("core/jspsych"), [
    "core/jspsych/css/jspsych.css",
    "core/jspsych/jspsych.js",
    "core/jspsych/plugins/plugin-call-function.js",
    "core/jspsych/plugins/plugin-canvas-keyboard-response.js",
    "core/jspsych/plugins/plugin-html-button-response.js",
    "core/jspsych/plugins/plugin-instructions.js",
  ]);
});

test("experiment pages reference tracked jsPsych assets", () => {
  const tracked_assets = new Set(walkFiles("core/jspsych"));
  const experiment_pages = walkFiles("experiments")
    .filter((file) => file.endsWith("/index.html"));
  const missing = [];

  for (const page of experiment_pages) {
    const html = readFileSync(resolve(ROOT, page), "utf8");
    const matches = html.matchAll(/(?:src|href)="(core\/jspsych\/[^"]+)"/g);
    for (const match of matches) {
      if (!tracked_assets.has(match[1])) {
        missing.push(`${page}: ${match[1]}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test("repo stays static-hosting first", () => {
  const forbidden = [
    ["ja", "tos"].join(""),
    ["end", "Study"].join(""),
    ["using_", "ja", "tos"].join(""),
    ["study", "ResultId"].join(""),
  ];
  const offenders = [];

  for (const file of walkFiles()) {
    if (BINARY_EXTENSIONS.has(extname(file))) {
      continue;
    }
    const text = readFileSync(resolve(ROOT, file), "utf8").toLowerCase();
    for (const term of forbidden) {
      if (text.includes(term.toLowerCase())) {
        offenders.push(`${file}: ${term}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
