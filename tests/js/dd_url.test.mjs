import { test } from "node:test";
import assert from "node:assert/strict";

import { getRunSelection } from "../../experiments/delay_discounting/dd_url.js";

function selection(query) {
  return getRunSelection(new URLSearchParams(query));
}

function selectionWithWarnings(query) {
  const original_warn = console.warn;
  const warnings = [];
  console.warn = function(message) {
    warnings.push(message);
  };

  try {
    return {
      result: selection(query),
      warnings,
    };
  } finally {
    console.warn = original_warn;
  }
}

test("getRunSelection defaults to Stan ADO", () => {
  assert.deepEqual(selection(""), {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });
});

test("getRunSelection resolves canonical mock controller", () => {
  assert.deepEqual(selection("controller=mock"), {
    controller_mode: "mock",
    design_strategy: null,
    ado_mode: "mock",
  });
});

test("getRunSelection resolves canonical random design strategy", () => {
  assert.deepEqual(selection("controller=stan&strategy=random"), {
    controller_mode: "stan",
    design_strategy: "random",
    ado_mode: "random",
  });
});

test("getRunSelection preserves legacy ado aliases", () => {
  assert.deepEqual(selection("ado=mock"), {
    controller_mode: "mock",
    design_strategy: null,
    ado_mode: "mock",
  });

  assert.deepEqual(selection("ado=random"), {
    controller_mode: "stan",
    design_strategy: "random",
    ado_mode: "random",
  });

  assert.deepEqual(selection("ado=stan"), {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });

  assert.deepEqual(selection("ado=ado"), {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });
});

test("getRunSelection lets canonical params override legacy ado", () => {
  const run = selectionWithWarnings("ado=random&controller=stan&strategy=ado");

  assert.deepEqual(run.result, {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });
  assert.equal(run.warnings.length, 1);
  assert.match(run.warnings[0], /Both legacy ado=/);
});

test("getRunSelection warns and falls back for invalid controller or strategy", () => {
  const invalid_controller = selectionWithWarnings("controller=nope");
  assert.deepEqual(invalid_controller.result, {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });
  assert.equal(invalid_controller.warnings.length, 1);
  assert.match(invalid_controller.warnings[0], /Unknown controller/);

  const invalid_strategy = selectionWithWarnings("strategy=nope");
  assert.deepEqual(invalid_strategy.result, {
    controller_mode: "stan",
    design_strategy: "ado",
    ado_mode: "stan",
  });
  assert.equal(invalid_strategy.warnings.length, 1);
  assert.match(invalid_strategy.warnings[0], /Unknown strategy/);
});

test("getRunSelection ignores strategy when controller is mock", () => {
  const run = selectionWithWarnings("controller=mock&strategy=random");

  assert.deepEqual(run.result, {
    controller_mode: "mock",
    design_strategy: null,
    ado_mode: "mock",
  });
  assert.equal(run.warnings.length, 1);
  assert.match(run.warnings[0], /strategy= is ignored/);
});
