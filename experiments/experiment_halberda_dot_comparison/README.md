# Halberda-style Dot Comparison Task in jsPsych

This is a small jsPsych reproduction of the core non-verbal number acuity task from:

Halberda, J., Mazzocco, M. M. M., & Feigenson, L. (2008). Individual differences in non-verbal number acuity correlate with maths achievement. *Nature, 455*, 665-668.

## Task

Participants briefly see intermixed blue and yellow dots and answer which color has more dots.

## Structure

- `index.html`: loads jsPsych, the canvas keyboard plugin, CSS, and the experiment script.
- `experiment.js`: contains all task logic, stimulus generation, trial generation, data coding, downloads, and the results plot.
- `style.css`: task and results-screen styling.

## Current parameters

- Fixation: 250 ms
- Dot display: 200 ms
- Response keys: `B` for blue, `Y` for yellow
- Ratios: 1:2, 3:4, 5:6, 7:8
- Total test trials: 40
- Visual controls: size-controlled and total-area-controlled trials

## How to run

Open the folder in VS Code and run `index.html` using Live Server.

You can also upload the three files to a static web host or GitHub Pages.

To label a participant, add a query parameter:

```text
index.html?participant=S001
```

## Saved data

At the end of the experiment the page automatically downloads a raw CSV file and shows buttons for:

- raw trial-level CSV
- ratio-summary CSV
- JSON containing raw trials, summary rows, and the fitted Weber fraction
- PNG of the paper-style performance plot

The raw CSV includes participant/session IDs, trial index, ratio, dot counts, correct answer, response, accuracy, response time, and visual-control mode.

## Paper-style plot

The results screen plots percent correct by ratio using the Figure 1b convention from the paper: the x-axis is bigger set / smaller set, the y-axis is percent correct, blue points show observed performance, and the dashed orange curve shows a simple ANS psychophysics model fit with one Weber fraction (`w`) parameter.

## Adult version

For adult participants, consider editing `RATIOS` in `experiment.js` to harder ratios, for example:

```js
const RATIOS = [
  {small: 5, large: 6, label: '5:6'},
  {small: 7, large: 8, label: '7:8'},
  {small: 9, large: 10, label: '9:10'},
  {small: 11, large: 12, label: '11:12'}
];
```

## Notes

This is a behavioral/task-logic reproduction, not an exact reconstruction of every original stimulus image. It is meant as a clean starting point for jsPsych development and later adaptive/ADO versions.
