import { test } from "node:test";
import assert from "node:assert/strict";
import { arange, linspace } from "../../src/ado/grid.js";
import { arange as arangeFacade, linspace as linspaceFacade } from "../../src/index.js";

// arange: half-open [start, stop) — the np.arange semantics that the old
// delay_discounting range() used (`value < stop`).
test("arange is half-open: stop is excluded", () => {
  assert.deepEqual(arange(0, 10, 2), [0, 2, 4, 6, 8]);
  assert.deepEqual(arange(0, 1, 0.25), [0, 0.25, 0.5, 0.75]);
});

test("arange rounds to 10 decimals so float steps stay clean", () => {
  assert.deepEqual(arange(0, 0.7, 0.1), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
});

test("arange excludes the endpoint even when float undershoot would re-include it (#2)", () => {
  // 0.1 steps: the raw accumulator reaches 0.9999999999999999 (< 1) on the 11th
  // step, which used to round up to 1 and wrongly include the excluded endpoint.
  const tenths = arange(0, 1, 0.1);
  assert.equal(tenths.length, 10);
  assert.equal(tenths.at(-1), 0.9);
  assert.deepEqual(arange(0, 0.9, 0.3), [0, 0.3, 0.6]);
  assert.deepEqual(arange(0, 0.3, 0.1), [0, 0.1, 0.2]);
});

test("arange rejects a non-positive step", () => {
  assert.throws(() => arange(0, 10, 0), /step must be a positive number/);
  assert.throws(() => arange(0, 10, -1), /step must be a positive number/);
});

// linspace: inclusive [start, stop] with a fixed count — the np.linspace semantics.
test("linspace is inclusive of both endpoints with num points", () => {
  assert.deepEqual(linspace(0, 10, 5), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(linspace(4, 48, 12), [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48]);
});

test("linspace(start, stop, 1) returns [start]", () => {
  assert.deepEqual(linspace(5, 99, 1), [5]);
});

test("linspace rejects a non-integer or < 1 num", () => {
  assert.throws(() => linspace(0, 10, 0), /num must be an integer >= 1/);
  assert.throws(() => linspace(0, 10, 2.5), /num must be an integer >= 1/);
});

// Regression guards: the migrated tasks must produce byte-identical grids to the
// pre-refactor local range() helpers (which differed in endpoint inclusivity).
test("arange reproduces the legacy delay-discounting r_ss grid byte-for-byte", () => {
  // old: range(12.5, 800, 12.5) with `value < stop` (half-open).
  const legacy = [];
  for (let v = 12.5; v < 800; v += 12.5) legacy.push(Number(v.toFixed(10)));
  assert.deepEqual(arange(12.5, 800, 12.5), legacy);
  assert.equal(arange(12.5, 800, 12.5).length, 63);
  assert.equal(arange(12.5, 800, 12.5).at(-1), 787.5);
});

test("linspace reproduces the legacy line-length deltas byte-for-byte", () => {
  // old: range(4, 48, 4) with `value <= stop` (INCLUSIVE — kept 48).
  const legacy = [];
  for (let v = 4; v <= 48; v += 4) legacy.push(Number(v.toFixed(10)));
  assert.deepEqual(linspace(4, 48, 12), legacy);
});

test("the facade re-exports the same helpers", () => {
  assert.equal(arangeFacade, arange);
  assert.equal(linspaceFacade, linspace);
});
