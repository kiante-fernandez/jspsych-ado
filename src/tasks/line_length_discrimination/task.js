// 3-interval forced-choice (3IFC) line-length discrimination task — the HTML presentation
// for the categorical line_length_discrimination_3ifc model (src/models/). Each trial shows
// three lines (A/B/C); one interval (the target) is longer than a common standard by
// `delta`, and the participant picks the longest. The design grid crosses standard length x
// delta x which interval is the target. Response space is categorical (3 outcomes, 0..2 = A/B/C).
//
// NOTE: this task's FOLDER is `line_length_discrimination`, but its `id` (and the paired
// MODEL folder) is `line_length_discrimination_3ifc` — the `_3ifc` suffix names the
// 3-interval-forced-choice variant. The id is what is saved to data and matched to the model.

import { linspace } from "../../ado/grid.js";

const LINE_KEYS = ["line_length_a", "line_length_b", "line_length_c"];

const response_labels = {
  0: "A",
  1: "B",
  2: "C",
};

const choices = ["A", "B", "C"];

/**
 * Pixel length of line `index` (0=A, 1=B, 2=C) for a design. Uses the explicit
 * line_length_<a|b|c> key when present; otherwise derives it as standard_length, plus
 * `delta` for the target interval. (Both paths exist because designs may arrive either
 * fully expanded or as {standard_length, delta, target_index}.)
 */
function getLineLength(design, index) {
  const key = LINE_KEYS[index];
  if (typeof design[key] === "number") {
    return design[key];
  }
  return design.standard_length + (Number(design.target_index) === index ? design.delta : 0);
}

/**
 * Build one 3IFC design: three lines at `standard_length`, with `delta` added to the
 * `target_index` interval. Returns both the parametric fields and the expanded
 * line_length_<a|b|c> keys.
 */
function make3IFCDesign(standard_length, delta, target_index) {
  const design = {
    standard_length: standard_length,
    delta: delta,
    target_index: target_index,
    target_label: response_labels[target_index],
  };
  for (let i = 0; i < LINE_KEYS.length; i++) {
    design[LINE_KEYS[i]] = standard_length + (i === target_index ? delta : 0);
  }
  return design;
}

/** Cartesian product of standard lengths x deltas x target intervals -> the design grid. */
function make3IFCDesigns({ standard_lengths, deltas, target_indices }) {
  const designs = [];
  for (const standard_length of standard_lengths) {
    for (const delta of deltas) {
      for (const target_index of target_indices) {
        designs.push(make3IFCDesign(standard_length, delta, target_index));
      }
    }
  }
  return designs;
}

function makeLineLengthStimulus(design) {
  let rows = "";
  for (let i = 0; i < LINE_KEYS.length; i++) {
    rows +=
      '<div class="ll-line-row">' +
      '<div class="ll-line-label">' +
      response_labels[i] +
      "</div>" +
      '<div class="ll-line-stage">' +
      '<div class="ll-line" style="width: ' +
      getLineLength(design, i) +
      'px;"></div>' +
      "</div>" +
      "</div>";
  }

  return (
    '<div class="ll-stimulus-wrap">' +
    '<div class="ll-line-list">' +
    rows +
    "</div>" +
    '<p class="ll-prompt">Which line is longest?</p>' +
    "</div>"
  );
}

function makeChoiceButtonHtml() {
  return choices.map(() => '<button class="ll-choice-button">%choice%</button>');
}

function describeDesign(design) {
  return [
    "standard_length: " + design.standard_length + " px",
    "delta: +" + design.delta + " px",
    "target: " + design.target_label,
    "A: " + getLineLength(design, 0) + " px",
    "B: " + getLineLength(design, 1) + " px",
    "C: " + getLineLength(design, 2) + " px",
  ];
}

const design_grid = make3IFCDesigns({
  standard_lengths: [200],
  deltas: linspace(4, 48, 12), // 12 deltas, 4 .. 48 inclusive (step 4)
  target_indices: [0, 1, 2],
});

const presentation = {
  makeStimulus: makeLineLengthStimulus,
  button_html: makeChoiceButtonHtml,
  keymap: { a: 0, b: 1, c: 2 },
  prompt:
    '<p style="margin-top: 1.25rem; font-size: 0.82rem; color: #9ca3af;">Press <strong>A</strong>, <strong>B</strong>, or <strong>C</strong></p>',
  describeDesign: describeDesign,
};

const lineLengthDiscriminationTask = {
  id: "line_length_discrimination_3ifc",
  design_grid,
  designKeys: [
    "standard_length",
    "delta",
    "target_index",
    "target_label",
    "line_length_a",
    "line_length_b",
    "line_length_c",
  ],
  responseSpace: { type: "categorical", n_categories: 3 },
  presentation,
  choices: choices,
  response_labels: response_labels,
};

export default lineLengthDiscriminationTask;
export {
  LINE_KEYS,
  choices,
  design_grid,
  describeDesign,
  getLineLength,
  lineLengthDiscriminationTask,
  make3IFCDesign,
  make3IFCDesigns,
  makeChoiceButtonHtml,
  makeLineLengthStimulus,
  presentation,
  response_labels,
};
