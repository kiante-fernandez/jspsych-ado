import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildInfoGainSvg,
  buildLinePath,
  getFiniteTracePoints,
  getInfoGainScale,
  renderInfoGainDebugPanel,
} from "../../experiments/delay_discounting/ado/debug_trace_charts.js";

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

test("buildInfoGainSvg renders expected and realized information gain as SVG paths", () => {
  const output = buildInfoGainSvg([0.01, 0.03, 0.02], [0.02, 0.01, 0.04]);

  assert.match(output, /<svg/);
  assert.match(output, /aria-label="Information gain over trials"/);
  assert.match(output, /stroke="#2563eb"/);
  assert.match(output, /stroke="#dc2626"/);
  assert.equal((output.match(/<path/g) || []).length, 2);
  assert.doesNotMatch(output, /[╱╲│─+]/u);
});

test("renderInfoGainDebugPanel includes latest values and legend labels", () => {
  const output = renderInfoGainDebugPanel([0.01, 0.03], [0.02, 0.01]);

  assert.match(output, /Information gain/);
  assert.match(output, /trial 2/);
  assert.match(output, /Expected max MI/);
  assert.match(output, /Realized IG/);
  assert.match(output, /max MI 0.03/);
  assert.match(output, /realized IG 0.01/);
});

test("buildInfoGainSvg draws single-point histories with point markers", () => {
  const output = buildInfoGainSvg([0.02], []);

  assert.match(output, /<circle/);
  assert.match(output, /<path d="M /);
});
