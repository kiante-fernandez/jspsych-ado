// Declarative jsPsych-rows -> Stan-data assembly.
//
// Models used to hand-write a buildData(trials) that did the same mechanical thing:
// N = trials.length, map each design column to an array, and map the response to y
// (with a +1 for 1-indexed categoricals — a convention you had to remember). That is
// pure boilerplate and the top source of silent shape bugs, so a model now declares a
// `stanData` MAP that mirrors its .stan `data` block and we generate the builder.
//
// The map is keyed by Stan data-block variable name; each value is one of:
//   "<trialKey>"               -> trials.map(t => t[trialKey])            (copy a column)
//   "response"                 -> the participant outcome (jsPsych `choice`);
//                                 auto +1 when responseSpace.type === "categorical"
//   { from: "<key>", index1: true } -> trials.map(t => Number(t[key]) + 1) (1-indexed Stan int)
//   { from: "<key>" }          -> trials.map(t => t[key])                 (renamed column)
// `N` is injected automatically and must NOT appear in the map.
//
// The map is a 1:1 mirror of the .stan data block, NOT a computation DSL — derived or
// ragged columns still belong in a hand-written buildData (or the .stan transformed
// block). buildData/toStanData remain supported and take precedence.

const RESPONSE = "response";

/**
 * Validate a stanData spec. Returns an array of error strings (empty if valid).
 *
 * @param {Object} stanData - The model's stanData map.
 * @returns {string[]} Problems, each a human-readable message.
 */
function validateStanDataSpec(stanData) {
  const problems = [];
  if (!stanData || typeof stanData !== "object" || Array.isArray(stanData)) {
    return ["`stanData` must be an object mapping Stan data-block variable names to sources."];
  }
  if ("N" in stanData) {
    problems.push(
      "`stanData` must not declare `N`; it is injected automatically from trials.length.",
    );
  }
  for (const [stanVar, src] of Object.entries(stanData)) {
    if (typeof src === "string") {
      if (!src) problems.push(`stanData["${stanVar}"] is an empty string.`);
    } else if (src && typeof src === "object") {
      if (typeof src.from !== "string" || !src.from) {
        problems.push(`stanData["${stanVar}"] object form must have a string \`from\`.`);
      }
    } else {
      problems.push(
        `stanData["${stanVar}"] must be a trial-key string, "response", or { from, index1? }.`,
      );
    }
  }
  return problems;
}

/**
 * Build a buildData(trials) function from a stanData map. Output is the Stan data
 * object: { N, ...declared columns }.
 *
 * @param {Object} spec
 * @param {Object} spec.stanData - The stanData map (see module header).
 * @param {Object} [spec.responseSpace] - {type:"binary"|"categorical", ...}; drives the
 *   "response" column's +1 (categorical responses are 1-indexed in Stan).
 * @returns {(trials: Array<Object>) => Object} The generated builder.
 */
function makeStanDataBuilder({ stanData, responseSpace } = {}) {
  const problems = validateStanDataSpec(stanData);
  if (problems.length) {
    throw new Error("makeStanDataBuilder: invalid stanData spec:\n  - " + problems.join("\n  - "));
  }
  const addOne = responseSpace && responseSpace.type === "categorical";
  const columns = Object.entries(stanData).map(([stanVar, src]) => {
    if (src === RESPONSE) {
      return [stanVar, (t) => (addOne ? Number(t.choice) + 1 : t.choice)];
    }
    if (src && typeof src === "object") {
      return [stanVar, src.index1 ? (t) => Number(t[src.from]) + 1 : (t) => t[src.from]];
    }
    return [stanVar, (t) => t[src]];
  });
  return function buildData(trials) {
    const data = { N: trials.length };
    for (const [stanVar, fn] of columns) {
      data[stanVar] = trials.map(fn);
    }
    return data;
  };
}

export { makeStanDataBuilder, validateStanDataSpec };
