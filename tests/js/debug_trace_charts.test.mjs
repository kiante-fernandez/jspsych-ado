import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildInfoGainSvg,
  buildLinePath,
  getFiniteTracePoints,
  getInfoGainScale,
  removeInfoGainDebugPanel,
  renderInfoGainDebugPanel,
  updateInfoGainDebugPanel,
} from "../../src/ado/debug/debug_trace_charts.js";

test("getFiniteTracePoints keeps original trial numbers when values are missing", () => {
  const points = getFiniteTracePoints([null, 0.04, Number.NaN, 0.02]);

  assert.deepEqual(points, [
    { trial: 2, value: 0.04 },
    { trial: 4, value: 0.02 },
  ]);
});

test("buildLinePath connects every finite trial point", () => {
  const points = getFiniteTracePoints([0.01, 0.03, 0.02]);
  const scale = getInfoGainScale(points, [], { width: 220, height: 140 });
  const path = buildLinePath(points, scale);

  assert.match(path, /^M \d+\.\d \d+\.\d L \d+\.\d \d+\.\d L \d+\.\d \d+\.\d$/);
  assert.equal((path.match(/ L /g) || []).length, 2);
});

test("buildInfoGainSvg renders selected design MI and realized information gain as SVG paths", () => {
  const output = buildInfoGainSvg([0.01, 0.03, 0.02], [0.02, 0.01, 0.04]);

  assert.match(output, /<svg/);
  assert.match(output, /aria-label="Information gain over trials"/);
  assert.match(output, /stroke="#2563eb"/);
  assert.match(output, /stroke="#dc2626"/);
  assert.equal((output.match(/<path/g) || []).length, 2);
  assert.doesNotMatch(output, /[╱╲│─+]/u);
});

test("renderInfoGainDebugPanel includes latest values and honest legend labels", () => {
  const output = renderInfoGainDebugPanel([0.01, 0.03], [0.02, 0.01]);

  assert.match(output, /Information gain/);
  assert.match(output, /trial 2/);
  assert.match(output, /Selected design MI/);
  assert.match(output, /Realized IG/);
  assert.match(output, /selected design MI 0.03/);
  assert.match(output, /realized IG 0.01/);
  assert.doesNotMatch(output, /Expected max MI/);
});

test("renderInfoGainDebugPanel omits realized information gain when unavailable", () => {
  const output = renderInfoGainDebugPanel([0.01, 0.03], [null, null]);

  assert.match(output, /Information gain/);
  assert.match(output, /trial 2/);
  assert.match(output, /Selected design MI/);
  assert.match(output, /selected design MI 0.03/);
  assert.doesNotMatch(output, /Realized IG/);
  assert.doesNotMatch(output, /realized IG NA/);
});

test("updateInfoGainDebugPanel does not create a panel without finite data", () => {
  const original_document = globalThis.document;
  let created = false;
  globalThis.document = {
    body: {
      appendChild: () => {
        created = true;
      },
    },
    createElement: () => ({ setAttribute: () => {}, style: {}, innerHTML: "" }),
    getElementById: () => null,
  };

  try {
    const panel = updateInfoGainDebugPanel([null], [Number.NaN]);
    assert.equal(panel, null);
    assert.equal(created, false);
  } finally {
    globalThis.document = original_document;
  }
});

test("removeInfoGainDebugPanel removes the debug panel when present", () => {
  const original_document = globalThis.document;
  let removed = false;
  globalThis.document = {
    body: {},
    getElementById: (id) =>
      id === "ado-info-gain-debug-panel"
        ? {
            remove: () => {
              removed = true;
            },
          }
        : null,
  };

  try {
    removeInfoGainDebugPanel();
    assert.equal(removed, true);
  } finally {
    globalThis.document = original_document;
  }
});

test("removeInfoGainDebugPanel is safe without a document", () => {
  const original_document = globalThis.document;
  delete globalThis.document;

  try {
    assert.doesNotThrow(() => removeInfoGainDebugPanel());
  } finally {
    globalThis.document = original_document;
  }
});
