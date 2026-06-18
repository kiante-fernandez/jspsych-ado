import { getRunSelection as getSharedRunSelection } from "../../jspsych-ado/ado/experiment_shell.js";

/**
 * Resolve delay-discounting URLs, retaining `ado=` as a legacy alias.
 *
 * @param {URLSearchParams} params - Experiment URL search params.
 * @returns {Object} Resolved controller_mode, design_strategy, and legacy ado_mode.
 */
function getRunSelection(params) {
  return getSharedRunSelection(params, {
    allow_legacy_ado: true,
    controllers: ["mock", "stan", "quest_plus"],
  });
}

export {
  getRunSelection,
};
