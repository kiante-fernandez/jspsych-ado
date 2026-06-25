import { createSeededRng } from "./ado/ado_simulation.js";
import {
  enumerateDesigns,
  getResponseProbsFunction,
  makeContinuousSupportResolver,
  samplePriorDraws,
  validateResponseProbs,
} from "./ado/mi_engine.js";
import { validateStanDataSpec } from "./ado/stan_data.js";

// Task / model validation for the jsPsychADO façade.
//
// Three entry points, plus the response-space predicates they share:
//   - validateTask(task)                       — a task package's shape
//   - validateModel(model, opts)               — a model package's shape (+ optional probe)
//   - validateTaskModelPair(task, model, ...)  — that a registered task+model fit
//     (matching designKeys, matching responseSpace, a likelihood probe, a buildData probe)
// before createTimeline builds anything. The functions are pure and synchronous; the
// façade owns the registries and throws/warns based on the problems they return.

const SAMPLEABLE_PRIOR_DISTS = new Set(["lognormal", "normal", "halfnormal"]);

// Fields that belong on a TASK, never on a model. Both registerModel (façade) and
// validateModel reject these, so the list lives here once and is shared.
const TASK_ONLY_FIELDS = [
  "design_grid",
  "presentation",
  "choices",
  "response_labels",
  "responseToOutcome",
  "task",
];

function getResponseCount(responseSpace) {
  if (!responseSpace || typeof responseSpace.type !== "string") {
    return null;
  }
  if (responseSpace.type === "binary") {
    return 2;
  }
  if (
    responseSpace.type === "categorical" &&
    Number.isInteger(responseSpace.n_categories) &&
    responseSpace.n_categories >= 2
  ) {
    return responseSpace.n_categories;
  }
  return null;
}

// A continuous response has no finite category count; the engine scores it by
// numerical integration of a density rather than enumerating outcomes.
function isContinuous(responseSpace) {
  return Boolean(responseSpace) && responseSpace.type === "continuous";
}

// One source of truth for what a CONTINUOUS model must provide. Returns problem
// messages (empty if OK); registerModel throws the first, validateModel collects all.
function continuousModelProblems(model) {
  const problems = [];
  if (typeof model.responseDensity !== "function") {
    problems.push("continuous models must provide responseDensity(design, draw, y).");
  }
  if (typeof model.responseMoments !== "function" && model.responseSupport == null) {
    problems.push(
      "continuous models need responseMoments(design, draw) => {mean, sd} or an explicit responseSupport for the integration support.",
    );
  }
  return problems;
}

// Probe a continuous model's density at a representative response value. Returns an
// error message, or null when the density is a finite nonnegative number. Shared by
// validateTaskModelPair and validateModel.
function probeContinuousDensity(model, design, draw) {
  const support = makeContinuousSupportResolver(model)(design, [draw]);
  const probe_y = (support[0] + support[1]) / 2;
  const density = model.responseDensity(design, draw, probe_y);
  if (typeof density !== "number" || !Number.isFinite(density) || density < 0) {
    return `response density probe returned ${density}; expected a finite nonnegative number`;
  }
  // If a fast-path factory is supplied, it must compute the same density (the engine
  // uses it on the MI hot loop while realized gain still uses responseDensity).
  if (typeof model.responseDensityFactory === "function") {
    const fast = model.responseDensityFactory(design, draw)(probe_y);
    if (!Number.isFinite(fast) || Math.abs(fast - density) > 1e-9 * (1 + Math.abs(density))) {
      return `responseDensityFactory disagrees with responseDensity (${fast} vs ${density}); they must compute the same density`;
    }
  }
  return null;
}

/**
 * Validate a responseSpace shape. Returns an error string (prefixed with `context`) or null
 * if valid. Accepts {type:"binary"}, {type:"categorical", n_categories>=2}, and
 * {type:"continuous"} (optional integer intervals>=2).
 */
function validateResponseSpace(responseSpace, context) {
  if (!responseSpace || typeof responseSpace.type !== "string") {
    return `${context}: responseSpace.type must be a string.`;
  }
  if (responseSpace.type === "binary") {
    return null;
  }
  if (responseSpace.type === "categorical") {
    if (!Number.isInteger(responseSpace.n_categories) || responseSpace.n_categories < 2) {
      return `${context}: categorical responseSpace needs integer n_categories >= 2.`;
    }
    return null;
  }
  if (responseSpace.type === "continuous") {
    if (
      responseSpace.intervals != null &&
      (!Number.isInteger(responseSpace.intervals) || responseSpace.intervals < 2)
    ) {
      return `${context}: continuous responseSpace intervals must be an integer >= 2.`;
    }
    return null;
  }
  return `${context}: responseSpace type "${responseSpace.type}" is not supported.`;
}

function countLabels(labels) {
  if (Array.isArray(labels)) {
    return labels.length;
  }
  if (labels && typeof labels === "object") {
    return Object.keys(labels).length;
  }
  return null;
}

function findUndefined(value, path = "data") {
  if (value === undefined) {
    return path;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUndefined(value[i], `${path}[${i}]`);
      if (found) {
        return found;
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findUndefined(child, `${path}.${key}`);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Validate that a registered task and model are compatible, THROWING if not (this is the
 * gate createTimeline calls before building). Checks: the model's designKeys are all present
 * in the task; the responseSpaces match (type + category count for discrete); a prior-draw
 * likelihood probe returns the right number of probabilities (or a finite density for
 * continuous); and a buildData probe returns a Stan data object with no undefined fields.
 *
 * @param {Object} task - Registered task spec.
 * @param {Object} model - Built model adapter.
 * @param {string} taskName - Task name (for the error message).
 * @param {string} modelName - Model name (for the error message).
 * @throws {Error} If the pair is incompatible (message lists every problem found).
 */
function validateTaskModelPair(task, model, taskName, modelName) {
  const problems = [];
  const task_keys = new Set(task.designKeys || []);
  for (const key of model.designKeys || []) {
    if (!task_keys.has(key)) {
      problems.push(`missing design key "${key}"`);
    }
  }

  const task_type = task.responseSpace && task.responseSpace.type;
  const model_type = model.responseSpace && model.responseSpace.type;
  if (task_type !== model_type) {
    problems.push(`responseSpace mismatch: task has "${task_type}", model has "${model_type}"`);
  } else if (
    !isContinuous(model.responseSpace) &&
    getResponseCount(task.responseSpace) !== getResponseCount(model.responseSpace)
  ) {
    // Category-count matching only applies to discrete responses; continuous has none.
    problems.push(
      `responseSpace category count mismatch: task has ${getResponseCount(task.responseSpace)}, model has ${getResponseCount(model.responseSpace)}`,
    );
  }

  let sample_design = null;
  try {
    const designs = enumerateDesigns(task.design_grid);
    sample_design = designs[0] || null;
    if (!sample_design) {
      problems.push("task design_grid produced no candidate designs");
    } else {
      const required_keys = new Set([...(task.designKeys || []), ...(model.designKeys || [])]);
      const seen_missing = new Set();
      designs.forEach((design, index) => {
        for (const key of required_keys) {
          if (!(key in design) && !seen_missing.has(key)) {
            problems.push(`task design_grid row ${index} is missing design key "${key}"`);
            seen_missing.add(key);
          }
        }
      });
    }
  } catch (e) {
    problems.push(`task design_grid could not be enumerated: ${String((e && e.message) || e)}`);
  }

  let sample_draw = null;
  if (sample_design) {
    try {
      sample_draw = samplePriorDraws(model.prior, 1, createSeededRng(8675309))[0];
      if (isContinuous(model.responseSpace)) {
        const probe_error = probeContinuousDensity(model, sample_design, sample_draw);
        if (probe_error) {
          problems.push(probe_error);
        }
      } else {
        const responseProbs = getResponseProbsFunction(model);
        const probs = validateResponseProbs(
          responseProbs(sample_design, sample_draw),
          "response likelihood probe",
        );
        const response_count = getResponseCount(model.responseSpace);
        if (probs.length !== response_count) {
          problems.push(
            `response likelihood returned ${probs.length} probabilities; expected ${response_count}`,
          );
        }
      }
    } catch (e) {
      problems.push(`response likelihood probe failed: ${String((e && e.message) || e)}`);
    }

    try {
      const stan_data = model.buildData([{ ...sample_design, choice: 1 }]);
      if (!stan_data || typeof stan_data !== "object") {
        problems.push("buildData probe did not return a Stan data object");
      } else {
        const undefined_path = findUndefined(stan_data);
        if (undefined_path) {
          problems.push(`buildData probe returned undefined at ${undefined_path}`);
        }
      }
    } catch (e) {
      problems.push(`buildData probe failed: ${String((e && e.message) || e)}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `model "${modelName}" is incompatible with task "${taskName}": ` + problems.join("; "),
    );
  }
}

/**
 * Validate a task package before registration.
 *
 * @param {Object} task - Task package default export.
 * @returns {{valid: boolean, problems: Array<{level: "error"|"warn", message: string}>}}
 */
function validateTask(task) {
  const problems = [];
  const err = (message) => problems.push({ level: "error", message });
  const warn = (message) => problems.push({ level: "warn", message });

  if (!task || typeof task !== "object") {
    return {
      valid: false,
      problems: [{ level: "error", message: "validateTask: task must be an object." }],
    };
  }
  if (typeof task.id !== "string" || !task.id) err("`id` must be a non-empty string.");
  if (task.design_grid == null) err("`design_grid` is required.");
  if (!Array.isArray(task.designKeys) || task.designKeys.length === 0) {
    err("`designKeys` must be a non-empty array.");
  }
  if (!task.responseSpace || typeof task.responseSpace.type !== "string") {
    err("`responseSpace.type` must be a string.");
  } else {
    const response_space_error = validateResponseSpace(task.responseSpace, "validateTask");
    if (response_space_error) {
      err(response_space_error);
    }
  }

  const presentation = task.presentation;
  if (
    !presentation ||
    (typeof presentation.getChoiceTrials !== "function" &&
      typeof presentation.makeStimulus !== "function")
  ) {
    err("`presentation` must provide getChoiceTrials(ctx) or makeStimulus(design).");
  }
  // Continuous responses have no discrete labels; response_labels only applies to
  // binary/categorical tasks.
  if (task.response_labels == null && !isContinuous(task.responseSpace)) {
    err("`response_labels` is required.");
  }
  if (task.choices == null && presentation && typeof presentation.makeStimulus === "function") {
    warn("`choices` is missing; the single-button presentation path needs choices in index order.");
  }
  const response_count = getResponseCount(task.responseSpace);
  if (response_count != null) {
    const label_count = countLabels(task.response_labels);
    if (label_count != null && label_count !== response_count) {
      err(`response_labels has ${label_count} entries; expected ${response_count}.`);
    }
    if (Array.isArray(task.choices) && task.choices.length !== response_count) {
      err(`choices has ${task.choices.length} entries; expected ${response_count}.`);
    }
  }

  if (task.design_grid != null) {
    try {
      const designs = enumerateDesigns(task.design_grid);
      if (designs.length === 0) {
        err("`design_grid` produced no candidate designs.");
      }
    } catch (e) {
      err(`design_grid could not be enumerated: ${String((e && e.message) || e)}.`);
    }
  }

  const valid = !problems.some((pr) => pr.level === "error");
  return { valid, problems };
}

/**
 * Validate a model-package default export (the shape under models/<name>/model.js).
 *
 * @param {Object} model - The model package default export.
 * @param {Object} [opts]
 * @param {Object} [opts.sampleDesign] - A design to probe responseProb/responseProbs/buildData with.
 * @param {Object} [opts.sampleDraw]   - A parameter draw to probe responseProb/responseProbs with.
 * @returns {{valid: boolean, problems: Array<{level: "error"|"warn", message: string}>}}
 */
function validateModel(model, opts = {}) {
  const problems = [];
  const err = (message) => problems.push({ level: "error", message });
  const warn = (message) => problems.push({ level: "warn", message });

  if (!model || typeof model !== "object") {
    return {
      valid: false,
      problems: [
        {
          level: "error",
          message: "validateModel: model must be an object (the model package default export).",
        },
      ],
    };
  }

  if (typeof model.id !== "string" || !model.id) err("`id` must be a non-empty string.");

  const params = Array.isArray(model.params) ? model.params : null;
  if (!params || params.length === 0 || !params.every((p) => typeof p === "string")) {
    err("`params` must be a non-empty array of parameter-name strings.");
  }
  if (typeof model.moduleUrl !== "string" || !model.moduleUrl) {
    err(
      '`moduleUrl` must be the compiled module URL (e.g. new URL("./main.js", import.meta.url).href).',
    );
  }
  // Not required (static-served deployments work without it), but a bundler
  // (Vite/webpack) hashes main.wasm, so without wasmUrl the model 404s its wasm
  // at runtime in a bundled build (#57).
  if (typeof model.wasmUrl !== "string" || !model.wasmUrl) {
    warn(
      '`wasmUrl` is not set (e.g. new URL("./main.wasm", import.meta.url).href). ' +
        "Static-served deployments still work, but bundlers (Vite/webpack) hash main.wasm, so the model would 404 its wasm at runtime (#57).",
    );
  }
  if (!Array.isArray(model.designKeys) || model.designKeys.length === 0) {
    err("`designKeys` must be a non-empty array.");
  }
  if (!model.responseSpace || typeof model.responseSpace.type !== "string") {
    err("`responseSpace.type` must be a string.");
  } else {
    const response_space_error = validateResponseSpace(model.responseSpace, "validateModel");
    if (response_space_error) {
      err(response_space_error);
    }
  }
  // Stan data plumbing: a declarative stanData map (preferred) OR a hand-written
  // buildData/toStanData escape hatch. Validate the map's shape when present.
  if (model.stanData != null) {
    for (const p of validateStanDataSpec(model.stanData)) err(p);
  } else if (typeof model.buildData !== "function" && typeof model.toStanData !== "function") {
    err("provide a `stanData` map (preferred), or `buildData(trials)`, or `toStanData(rows)`.");
  }
  if (isContinuous(model.responseSpace)) {
    for (const p of continuousModelProblems(model)) err(p);
  } else if (model.responseSpace && model.responseSpace.type === "categorical") {
    if (typeof model.responseProbs !== "function") {
      err("categorical models must provide `responseProbs(design, draw)`.");
    }
  } else if (
    typeof model.responseProb !== "function" &&
    typeof model.responseProbs !== "function"
  ) {
    err("`responseProb(design, draw)` or `responseProbs(design, draw)` must be a function.");
  }
  if (typeof model.choiceProbLL === "function") {
    err(
      "`choiceProbLL` has been replaced by `responseProb` for binary models or `responseProbs` for categorical models.",
    );
  }
  for (const k of TASK_ONLY_FIELDS) {
    if (model[k] != null) {
      err(`\`${k}\` belongs on a task package, not a model package.`);
    }
  }

  // Prior must cover every parameter, with a family the first-design sampler can draw.
  if (params && model.prior && typeof model.prior === "object") {
    for (const p of params) {
      const spec = model.prior[p];
      if (!spec || typeof spec !== "object") {
        err(
          `prior for "${p}" is missing; the engine samples the prior to choose the first design.`,
        );
      } else if (!SAMPLEABLE_PRIOR_DISTS.has(spec.dist)) {
        warn(
          `prior for "${p}" uses dist "${spec.dist}", which the first-design sampler can't draw ` +
            `(supports ${[...SAMPLEABLE_PRIOR_DISTS].join(", ")}). The first design would fail.`,
        );
      }
    }
  } else if (params) {
    err(
      "`prior` must be an object mapping each parameter to a {dist, ...} spec matching the .stan priors.",
    );
  }

  // Optional runtime probe.
  if (
    opts.sampleDesign &&
    isContinuous(model.responseSpace) &&
    typeof model.responseDensity === "function"
  ) {
    try {
      const probe_error = probeContinuousDensity(model, opts.sampleDesign, opts.sampleDraw || {});
      if (probe_error) {
        err(probe_error + ".");
      }
    } catch (e) {
      err(`response density threw on the sample design: ${String((e && e.message) || e)}.`);
    }
  } else if (
    opts.sampleDesign &&
    (typeof model.responseProb === "function" || typeof model.responseProbs === "function")
  ) {
    try {
      const responseProbs = getResponseProbsFunction(model);
      const probs = validateResponseProbs(
        responseProbs(opts.sampleDesign, opts.sampleDraw || {}),
        "validateModel",
      );
      const response_count = getResponseCount(model.responseSpace);
      if (response_count != null && probs.length !== response_count) {
        err(
          `response likelihood returned ${probs.length} probabilities; expected ${response_count}.`,
        );
      }
    } catch (e) {
      err(`response likelihood threw on the sample design: ${String((e && e.message) || e)}.`);
    }
  }

  const valid = !problems.some((pr) => pr.level === "error");
  return { valid, problems };
}

export {
  TASK_ONLY_FIELDS,
  isContinuous,
  continuousModelProblems,
  validateResponseSpace,
  validateTask,
  validateModel,
  validateTaskModelPair,
};
