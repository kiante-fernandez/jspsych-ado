import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStanDataBuilder, validateStanDataSpec } from "../../src/ado/stan_data.js";

test("copies trial columns and injects N", () => {
  const build = makeStanDataBuilder({
    stanData: { a: "a", b: "b" },
    responseSpace: { type: "binary" },
  });
  assert.deepEqual(
    build([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]),
    { N: 2, a: [1, 3], b: [2, 4] },
  );
});

test('"response" maps to the jsPsych choice; binary => no +1', () => {
  const build = makeStanDataBuilder({
    stanData: { y: "response" },
    responseSpace: { type: "binary" },
  });
  assert.deepEqual(build([{ choice: 0 }, { choice: 1 }]), { N: 2, y: [0, 1] });
});

test('categorical responseSpace adds +1 to the "response" column (1-indexed Stan)', () => {
  const build = makeStanDataBuilder({
    stanData: { y: "response" },
    responseSpace: { type: "categorical", n_categories: 3 },
  });
  assert.deepEqual(build([{ choice: 0 }, { choice: 2 }]), { N: 2, y: [1, 3] });
});

test("{ from, index1: true } reads a renamed column and adds +1", () => {
  const build = makeStanDataBuilder({
    stanData: { target_index: { from: "target_index", index1: true }, delta: "delta" },
    responseSpace: { type: "categorical", n_categories: 3 },
  });
  assert.deepEqual(
    build([
      { target_index: 0, delta: 8 },
      { target_index: 2, delta: 16 },
    ]),
    {
      N: 2,
      target_index: [1, 3],
      delta: [8, 16],
    },
  );
});

test("{ from } without index1 just renames a column (no offset)", () => {
  const build = makeStanDataBuilder({
    stanData: { stan_x: { from: "x" } },
    responseSpace: { type: "binary" },
  });
  assert.deepEqual(build([{ x: 5 }]), { N: 1, stan_x: [5] });
});

test("N must never be declared in the map", () => {
  assert.throws(
    () =>
      makeStanDataBuilder({
        stanData: { N: "n", y: "response" },
        responseSpace: { type: "binary" },
      }),
    /must not declare `N`/,
  );
});

test("validateStanDataSpec flags malformed specs", () => {
  assert.deepEqual(validateStanDataSpec({ a: "a" }), []);
  assert.ok(validateStanDataSpec(null).length > 0);
  assert.ok(validateStanDataSpec([]).length > 0);
  assert.ok(validateStanDataSpec({ a: "" }).some((m) => /empty string/.test(m)));
  assert.ok(validateStanDataSpec({ a: { index1: true } }).some((m) => /string `from`/.test(m)));
  assert.ok(validateStanDataSpec({ a: 42 }).some((m) => /trial-key string/.test(m)));
});
