/**
 * Resolve the public URL API into separate controller/backend and design
 * strategy concepts. `ado=` is retained only as a compatibility alias.
 *
 * @param {URLSearchParams} params - Experiment URL search params.
 * @returns {Object} Resolved controller_mode, design_strategy, and legacy ado_mode.
 */
function getRunSelection(params) {
  const requested_ado_mode = params.get("ado");
  const requested_controller = params.get("controller");
  const requested_strategy = params.get("strategy");

  // New URLs default to the real Stan controller with ADO-selected designs.
  let controller_mode = "stan";
  let design_strategy = "ado";

  // First translate old single-field URLs into the new two-field concepts.
  // This keeps existing shared links and notebooks working while making the
  // rest of the experiment code read controller/strategy separately.
  if (requested_ado_mode) {
    if (requested_ado_mode === "mock") {
      controller_mode = "mock";
      design_strategy = null;
    } else if (requested_ado_mode === "stan" || requested_ado_mode === "ado") {
      controller_mode = "stan";
      design_strategy = "ado";
    } else if (requested_ado_mode === "random") {
      controller_mode = "stan";
      design_strategy = "random";
    } else {
      console.warn(`Unknown legacy ado mode "${requested_ado_mode}"; running controller=stan&strategy=ado.`);
    }
  }

  // If a URL includes both styles, treat controller=/strategy= as the intended
  // new API and leave a warning so the mixed URL is easy to spot while debugging.
  if (requested_ado_mode && (requested_controller || requested_strategy)) {
    console.warn("Both legacy ado= and controller=/strategy= URL parameters were provided; using controller=/strategy=.");
  }

  // Canonical controller/backend choice: mock is the deterministic no-WASM
  // controller, stan is the live posterior update path.
  if (requested_controller) {
    if (["mock", "stan"].includes(requested_controller)) {
      controller_mode = requested_controller;
    } else {
      console.warn(`Unknown controller "${requested_controller}"; using controller=${controller_mode}.`);
    }
  }

  // Canonical design policy choice. This only matters for the Stan controller:
  // both strategies update the posterior, but random samples designs from the
  // same grid instead of selecting by mutual information.
  if (requested_strategy) {
    if (["ado", "random"].includes(requested_strategy)) {
      design_strategy = requested_strategy;
    } else {
      console.warn(`Unknown strategy "${requested_strategy}"; using strategy=${design_strategy || "none"}.`);
    }
  }

  // Mock mode owns its own deterministic design sequence, so a design strategy
  // would be misleading in run data. Store null rather than pretending mock is
  // using either ADO or random design selection.
  if (controller_mode === "mock") {
    if (requested_strategy) {
      console.warn("strategy= is ignored when controller=mock.");
    }
    design_strategy = null;
  }

  return {
    controller_mode,
    design_strategy,
    // Legacy flat field used in older data/debug logs.
    ado_mode: controller_mode === "mock" ? "mock" : (design_strategy === "random" ? "random" : "stan"),
  };
}

export {
  getRunSelection,
};
