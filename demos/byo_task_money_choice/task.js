// A task authored FROM SCRATCH for the "bring your own task" demo (pattern 2).
//
// It is a plain-text, two-button money-choice framing of delay discounting — a
// deliberately different presentation from the packaged delay_discounting task — but
// it produces designs in the SAME space ({t_ss, t_ll, r_ss, r_ll}) and the SAME
// response coding (0 = smaller-sooner, 1 = larger-later), so it pairs with the
// packaged hyperbolic model unchanged.
//
// In your own project this file would live wherever you keep experiment code; you
// register it with jsPsychADO.registerTask(task.id, task). A task owns three things:
//   1. design_grid   — the candidate designs ADO chooses among
//   2. presentation  — how a design is shown and answered
//   3. response coding — choices / response_labels (+ responseToOutcome if needed)

import { arange } from "../../jspsych-ado/ado/grid.js"; // reuse the shipped grid helper

function weeks(t) {
  if (t === 0) return "today";
  return t === 1 ? "in 1 week" : `in ${t} weeks`;
}

function money(amount) {
  return `$${Number(amount).toFixed(0)}`;
}

// One prompt above the two options.
function makeStimulus(design) {
  return `<p style="font-size:1.2rem;margin:0 0 1.5rem;">Which would you rather have?</p>`;
}

// Two plain buttons: index 0 = smaller-sooner, index 1 = larger-later.
function buttonHtml(design) {
  const ss = `${money(design.r_ss)} <span style="color:#6b7280">${weeks(design.t_ss)}</span>`;
  const ll = `${money(design.r_ll)} <span style="color:#6b7280">${weeks(design.t_ll)}</span>`;
  const btn = (label, key) =>
    `<button class="mc-btn"><span class="mc-key">${key}</span>${label}</button>`;
  return [btn(ss, "A"), btn(ll, "B")];
}

// A from-scratch candidate grid over the hyperbolic design space.
const design_grid = {
  t_ss: [0],
  t_ll: [1, 2, 3, 4, 6, 8, 12, 26, 52, 104, 156, 260],
  r_ss: arange(20, 500, 20), // 20, 40, ... 480
  r_ll: [500],
};

const moneyChoiceTask = {
  id: "money_choice",
  design_grid,
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  presentation: {
    makeStimulus,
    button_html: buttonHtml,
    keymap: { a: 0, b: 1 }, // A = sooner, B = later
    prompt: '<p style="margin-top:1rem;font-size:0.8rem;color:#9ca3af;">Press <strong>A</strong> for the sooner option · <strong>B</strong> for the later option</p>',
  },
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" }, // 0 = smaller-sooner, 1 = larger-later
  // responseToOutcome defaults to identity (button index already = outcome), so the
  // hyperbolic likelihood (y: 1 = chose larger-later) reads it directly.
};

export default moneyChoiceTask;
export { moneyChoiceTask, design_grid };
