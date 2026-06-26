# Tasks

Task packages define what participants see and what responses mean. They are
separate from model packages, so the same task can be paired with multiple
compatible models.

A task package exports:

```js
{
  id,              // task id saved into jsPsych data rows
  design_grid,     // candidate designs, object-of-arrays or array of objects
  designKeys,      // design fields provided by the grid
  responseSpace,   // {type:"binary"}, {type:"categorical", n_categories}, or {type:"continuous"}
  presentation,    // getChoiceTrials(ctx) OR makeStimulus(design)
  choices,         // button/key labels in index order (discrete tasks)
  response_labels, // labels by model outcome, e.g. {0:"SS", 1:"LL"} (omit for continuous)
  responseToOutcome, // optional (design, rawResponse) => model outcome/value
}
```

### Building grid axes

Use the shared helpers (also exported from `jspsych-ado`) to build the candidate
values for a design axis — they have explicit, numpy-matching endpoint semantics so
there is no inclusive-vs-exclusive ambiguity:

```js
import { arange, linspace } from "jspsych-ado";
arange(12.5, 800, 12.5); // HALF-OPEN [start, stop): 12.5 .. 787.5 (excludes 800)
linspace(4, 48, 12); // INCLUSIVE [start, stop]: 12 points, 4 .. 48
```

For simple button tasks, `presentation` provides `makeStimulus(design)` (plus optional
`button_html(design)`, `keymap`, `prompt`, and `describeDesign(design)`) and the
timeline builds the response-collecting button trial for you. This is the path an
external package consumer uses — no internal imports needed.

Richer tasks (multi-frame, canvas, slider) instead provide `getChoiceTrials(ctx)` and
mark the response-collecting trial with a factory helper: `htmlButtonChoice` /
`canvasResponse` collect a discrete choice, `canvasSliderChoice` collects a
**continuous** slider value, and `canvasFrame` shows a timed no-response frame. These
factories live in `src/ado/response_trials.js` and back the **shipped** task packages,
but they are **internal**: `jspsych-ado/ado/*` is not an exported package subpath, so
they are reachable by in-repo tasks (under `src/tasks/`) via a relative import, not by
external package consumers. A documented public task-authoring API for canvas/multi-frame
tasks is a possible future extension. The factories take the jsPsych plugin classes from
the plugins' UMD `<script>` globals on a static page, or injected via
`createTimeline(jsPsych, { ..., plugins })` under a bundler (see the top-level README
"Using with a bundler").

### Continuous-response tasks

For a continuous response set `responseSpace: {type:"continuous"}` and omit
`response_labels`/`choices`. Collect the value with `canvasSliderChoice` (a
canvas-slider-response trial), which records the raw slider value on
`data.__ado_response`. The paired model's density is over the modeled response space,
so use `responseToOutcome(design, rawValue)` to transform the raw slider value into it
(e.g. `Math.log(estimate)` for a log-log power-law model). See
`tasks/magnitude_estimation/task.js` (Stevens magnitude estimation) for a worked
example, paired with `models/magnitude_estimation/`.

## Styles

A task that emits HTML class names ships its stylesheet beside `task.js`. Load it
so the stimulus renders as designed:

- Bundler: `import "jspsych-ado/tasks/delay_discounting/task.css";`
- Static page: `<link rel="stylesheet" href=".../tasks/delay_discounting/task.css">`

Shipped task styles: `delay_discounting/task.css` (`.dd-*`) and
`line_length_discrimination/task.css` (`.ll-*`). Canvas tasks (e.g.
`halberda_dot_comparison`) draw to a canvas and need no stylesheet.

`createTimeline({ task, model })` checks that the model's `designKeys` are present
in the task grid and that the task/model response spaces are compatible before
building the adaptive timeline.

For finite categorical tasks, choices are integer indices `0..K-1` and the
paired model must return a probability vector of length `K` from
`responseProbs(design, params)`. For continuous tasks the model instead supplies a
response density (see the models README "Continuous-response models").
