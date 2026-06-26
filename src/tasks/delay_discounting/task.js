// Delay-discounting task package.
//
// A task defines the candidate designs, how a design is shown, and how raw
// jsPsych responses map onto model outcomes. The hyperbolic model lives under
// models/hyperbolic/ and only defines the likelihood and Stan data boundary.

import { arange } from "../../ado/grid.js";

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

/**
 * Build the prompt shown above the two option cards. The cards themselves carry
 * the design's rewards/delays (rendered as the button choices), so this prompt
 * text is fixed and does not depend on `design`.
 *
 * @param {Object} design - The current design (unused here; the prompt is fixed).
 * @returns {string} HTML stimulus for jsPsychHtmlButtonResponse.
 */
function makeStimulus(design) {
  return `<p style="font-size: 1.3rem; margin: 0 0 1.75rem;">Which would you prefer?</p>`;
}

/**
 * Build the HTML for one option card (index 0 = SS, 1 = LL).
 *
 * @param {Object} design - {t_ss, t_ll, r_ss, r_ll}.
 * @param {number} index - 0 for smaller-sooner, 1 for larger-later.
 * @returns {string} Button HTML for jsPsychHtmlButtonResponse.button_html.
 */
function makeOptionCardHtml(design, index) {
  const is_ss = index === 0;
  const amount = is_ss ? design.r_ss : design.r_ll;
  const delay = is_ss ? design.t_ss : design.t_ll;
  const key_hint = is_ss ? "S" : "L";
  const delay_text = delay === 0 ? "available now" : "available in " + formatDelay(delay);
  return (
    '<button class="dd-option-card">' +
    '<span class="dd-key-hint">' +
    key_hint +
    "</span>" +
    '<span class="dd-amount">' +
    formatReward(amount) +
    "</span>" +
    '<span class="dd-when">' +
    delay_text +
    "</span>" +
    "</button>"
  );
}

/**
 * One-line offer description for the debug log.
 *
 * @param {string} label - "SS" or "LL".
 * @param {number} reward - Reward amount.
 * @param {number} delay - Delay in weeks.
 * @returns {string} e.g. "SS: $400 now" or "LL: $800 in 52 weeks".
 */
function formatDebugOffer(label, reward, delay) {
  const delay_label = formatDelay(delay);
  const delay_text = delay_label === "now" ? delay_label : `in ${delay_label}`;
  return `${label}: ${formatReward(reward)} ${delay_text}`;
}

const design_grid = {
  t_ss: [0],
  t_ll: [0.43, 0.714, 1, 2, 3, 4.3, 6.44, 8.6, 10.8, 12.9, 17.2, 21.5, 26, 52, 104, 156, 260, 520],
  r_ss: arange(12.5, 800, 12.5), // half-open: 12.5 .. 787.5 (excludes 800)
  r_ll: [800],
};

const presentation = {
  makeStimulus,
  button_html: (design) => [makeOptionCardHtml(design, 0), makeOptionCardHtml(design, 1)],
  // Physical key -> button index, so S/L select the SS/LL cards.
  keymap: { s: 0, l: 1 },
  prompt:
    '<p style="margin-top: 1.25rem; font-size: 0.82rem; color: #9ca3af;">Press <strong>S</strong> for Smaller-sooner &nbsp;·&nbsp; Press <strong>L</strong> for Larger-later</p>',
  // Pretty offer lines for the debug console (falls back to key=value otherwise).
  describeDesign: (design) => [
    formatDebugOffer("SS", design.r_ss, design.t_ss),
    formatDebugOffer("LL", design.r_ll, design.t_ll),
  ],
};

const delayDiscountingTask = {
  id: "delay_discounting",
  design_grid,
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  presentation,
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" },
};

export default delayDiscountingTask;
export {
  delayDiscountingTask,
  design_grid,
  formatDelay,
  formatReward,
  makeStimulus,
  makeOptionCardHtml,
  presentation,
};
