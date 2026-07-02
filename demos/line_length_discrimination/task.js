import { linspace } from "jspsych-ado";

const LINE_KEYS = ["line_length_a", "line_length_b", "line_length_c"];

const response_labels = {
  0: "A",
  1: "B",
  2: "C",
};

// Static button labels also define the response-code order.
const choices = ["A", "B", "C"];

function getLineLength(design, index) {
  const key = LINE_KEYS[index];
  if (typeof design[key] === "number") {
    return design[key];
  }
  return design.standard_length + (Number(design.target_index) === index ? design.delta : 0);
}

// target_index is zero-indexed in JS; stanData converts it to Stan's 1-indexed category.
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

function makeChoiceButtonHtml(choice) {
  return '<button class="ll-choice-button">' + choice + "</button>";
}

// Debug output includes the latent target and realized line lengths.
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

export {
  LINE_KEYS,
  choices,
  design_grid,
  describeDesign,
  getLineLength,
  make3IFCDesign,
  make3IFCDesigns,
  makeChoiceButtonHtml,
  makeLineLengthStimulus,
  response_labels,
};
