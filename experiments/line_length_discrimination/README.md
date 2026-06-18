# 3IFC line-length discrimination ADO demo

This is a small jsPsych ADO demo for issue #58 and the categorical-response
work in issue #38. It is a concrete architecture target built around a
recognizable forced-choice psychophysics task.

Participants see three horizontal lines labeled A/B/C:

```text
A | standard or target length
B | standard or target length
C | standard or target length
```

Two lines are the same standard length. One target line is longer by `delta`.
The participant chooses which line is longest.

The task intentionally uses the stock `html-button-response` plugin and local
project dependencies (`core/jspsych`, `core/init_experiment.js`). There is no
custom jsPsych plugin, image asset, or canvas drawing. The adaptive path uses
the same shared experiment shell as delay discounting; task presentation and
model likelihood stay in their task/model packages.

## Model contract

`jspsych-ado/models/line_length_discrimination_3ifc/model.js` defines the
categorical likelihood shape used by the ADO engine:

```js
responseProbs(design, params) -> [p_a, p_b, p_c]
```

The model is a multinomial-logit observer. Each response position has evidence
based on its line-length difference from the standard, plus simple response
position biases for B and C. Larger `delta` values make the target line more
likely to be chosen.

The Stan model in `jspsych-ado/models/line_length_discrimination_3ifc/` matches
this JS likelihood. The task presentation and design grid live separately in
`jspsych-ado/tasks/line_length_discrimination/task.js`.

Response coding:

```js
0 = "A"
1 = "B"
2 = "C"
```

`buildData(trials)` maps these zero-indexed jsPsych choices and target indices
to one-indexed Stan categories (`1`, `2`, `3`).

## Relation to #38

The reusable ADO machinery supports finite categorical probability vectors in
addition to binary `responseProb(...)` models. The acceptance test is that this
3IFC task runs adaptively without adding line-length-specific code to the MI
engine.

Debug mode is generic: `debug=1` prints the current design, selection
diagnostics, posterior summary, and the next selected design using task-provided
design labels and model-provided posterior display metadata.

## URLs

Normal prototype:

```text
experiments/line_length_discrimination/index.html
```

Fast mock-controller visual check:

```text
experiments/line_length_discrimination/index.html?controller=mock&simulate=visual&debug=1
```

Data-only simulation:

```text
experiments/line_length_discrimination/index.html?simulate=data-only&debug=1
```

Data-only simulation stays fast for automated checks. Visual simulation uses the
shared slower timing defaults so viewers can see each stimulus, simulated
response, and debug update.

Quest+ categorical comparator:

```text
experiments/line_length_discrimination/index.html?controller=quest_plus&simulate=data-only&debug=1
```

Quest+ is an optional comparator controller. The page loads it only when
`controller=quest_plus` is selected. The current adapter is sequential-only and
does not support `testlet_size > 1`.

Visual simulation:

```text
experiments/line_length_discrimination/index.html?simulate=visual&debug=1
```
