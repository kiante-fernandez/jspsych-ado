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
  responseSpace,   // currently { type: "binary" }
  presentation,    // getChoiceTrials(ctx) OR makeStimulus(design)
  choices,         // button/key labels in index order
  response_labels, // labels by binary outcome, e.g. {0:"SS", 1:"LL"}
  responseToOutcome, // optional (design, choiceIndex) => 0|1
}
```

For simple button tasks, `presentation` can provide `makeStimulus(design)` plus
optional `button_html(design)`, `keymap`, `prompt`, and `describeDesign(design)`.
For multi-frame tasks, provide `getChoiceTrials(ctx)` and use the timeline helper
factories to mark the response-collecting trial.

`createTimeline({ task, model })` checks that the model's `designKeys` are present
in the task grid and that the task/model response spaces are compatible before
building the adaptive timeline.
