// Local delay-choice helpers for the bring-your-own-model demo.

import { arange } from "../../jspsych-ado/index.js";

const response_labels = { 0: "SS", 1: "LL" };

function formatDelay(delay) {
  if (delay === 0) {
    return "now";
  }
  if (delay === 1) {
    return "1 week";
  }
  return `${delay} weeks`;
}

function formatReward(reward) {
  return `$${Number(reward).toFixed(2).replace(".00", "")}`;
}

function makeOptionCardLabel(design, index) {
  const is_ss = index === 0;
  const amount = is_ss ? design.r_ss : design.r_ll;
  const delay = is_ss ? design.t_ss : design.t_ll;
  const key_hint = is_ss ? "S" : "L";
  const delay_text = delay === 0 ? "available now" : "available in " + formatDelay(delay);
  return "<span class=\"dd-key-hint\">" + key_hint + "</span>"
    + "<span class=\"dd-amount\">" + formatReward(amount) + "</span>"
    + "<span class=\"dd-when\">" + delay_text + "</span>";
}

// Response order is the model contract: 0 = smaller-sooner, 1 = larger-later.
function makeChoices(design) {
  return [makeOptionCardLabel(design, 0), makeOptionCardLabel(design, 1)];
}

function makeButtonHtml(choice) {
  return "<button class=\"dd-option-card\">" + choice + "</button>";
}

function formatDebugOffer(label, reward, delay) {
  const delay_label = formatDelay(delay);
  const delay_text = delay_label === "now" ? delay_label : `in ${delay_label}`;
  return `${label}: ${formatReward(reward)} ${delay_text}`;
}

// Debug output uses stable option labels rather than the full button HTML.
function describeDesign(design) {
  return [
    formatDebugOffer("SS", design.r_ss, design.t_ss),
    formatDebugOffer("LL", design.r_ll, design.t_ll),
  ];
}

const design_grid = {
  t_ss: [0],
  t_ll: [
    0.43, 0.714, 1, 2, 3,
    4.3, 6.44, 8.6, 10.8, 12.9,
    17.2, 21.5, 26, 52, 104,
    156, 260, 520
  ],
  r_ss: arange(12.5, 800, 12.5), // half-open: 12.5 .. 787.5 (excludes 800)
  r_ll: [800],
};

export {
  describeDesign,
  design_grid,
  makeButtonHtml,
  makeChoices,
  response_labels,
};
