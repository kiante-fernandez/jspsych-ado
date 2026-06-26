import { test } from "node:test";
import assert from "node:assert/strict";

import { createMockAdoController } from "../../src/controllers/mock_ado_controller.js";

test("mock controller does not emit Stan-only quantitative debug metrics", async () => {
  const controller = createMockAdoController({
    grid_design: { a: [1, 2], b: [3] },
    params: ["theta"],
  });

  const start = await controller.start({ session_id: "mock-test" });
  assert.equal(start.session_id, "mock-test");
  assert.equal(start.posterior_draws, undefined);
  assert.equal(start.realized_information_gain, undefined);
  assert.equal(start.realized_information_gains, undefined);

  const update = await controller.update({
    ado_trial_index: 0,
    ado_design: start.next_design,
    choice: 1,
  });
  assert.equal(update.posterior_draws, undefined);
  assert.equal(update.realized_information_gain, undefined);
  assert.equal(update.realized_information_gains, undefined);
  assert.equal(typeof update.post_mean.theta, "number");
});
