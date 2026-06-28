// Local task code for the "bring your own task" demo.
// It uses the hyperbolic model's delay-discounting design keys with different
// participant-facing button text.

import { arange } from "../../jspsych-ado/index.js"; // reuse the public grid helper

function weeks(t) {
  if (t === 0) return "today";
  return t === 1 ? "in 1 week" : `in ${t} weeks`;
}

function money(amount) {
  return `$${Number(amount).toFixed(0)}`;
}

// Response order is the model contract: 0 = smaller-sooner, 1 = larger-later.
function makeChoices(design) {
  const ss = `${money(design.r_ss)} <span style="color:#6b7280">${weeks(design.t_ss)}</span>`;
  const ll = `${money(design.r_ll)} <span style="color:#6b7280">${weeks(design.t_ll)}</span>`;
  const label = (text, key) => `<span class="mc-key">${key}</span>${text}`;
  return [label(ss, "A"), label(ll, "B")];
}

function buttonHtml(choice) {
  return '<button class="mc-btn">' + choice + '</button>';
}

// Stable labels for debug/data; the button text itself varies by design.
const response_labels = { 0: "SS", 1: "LL" };

function describeDesign(design) {
  return [
    "SS: " + money(design.r_ss) + " " + weeks(design.t_ss),
    "LL: " + money(design.r_ll) + " " + weeks(design.t_ll),
  ];
}

// A from-scratch candidate grid over the hyperbolic design space.
const design_grid = {
  t_ss: [0],
  t_ll: [1, 2, 3, 4, 6, 8, 12, 26, 52, 104, 156, 260],
  r_ss: arange(20, 500, 20), // 20, 40, ... 480
  r_ll: [500],
};

export {
  buttonHtml,
  describeDesign,
  design_grid,
  makeChoices,
  response_labels,
};
