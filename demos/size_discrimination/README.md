# Adaptive size discrimination (rt-task style)

The adaptive twin of the jsPsych documentation's
[simple reaction-time task](https://www.jspsych.org/latest/tutorials/rt-task/):
blue and orange circles, **F**/**J** keys, the same welcome → instructions →
trial loop → debrief shape — except here the **size difference adapts**. After
each response the posterior over the participant's Weber fraction `w` updates,
and ADO picks the next circle pair to be maximally informative: discriminating
participants get hard pairs, noisy ones get easier pairs.

Everything lives in one file ([index.html](index.html)) — no canvas, no task
package, no CSS file. The circles are two inline `<div>`s, the design grid is a
loop over base diameters × size ratios, and the model is the shipped
[`weber_dots`](../../src/models/weber_dots/model.js) package, which is generic
Weber discrimination over any two magnitudes (its `n_blue`/`n_yellow` design
keys are just the two diameters here).

The three ADO-specific pieces to look for:

1. `createController(jsPsych, { model, design_grid, n_trials })`
2. the stimulus reads `ado.evaluateDesignVariable("n_blue")` / `("n_yellow")`
3. `on_finish` maps the raw key to **correctness** and calls
   `ado.recordResponse(0 | 1)` — the model observes correct/incorrect, not F/J.

The debrief screen uses `ado.getState()` to show the participant their estimated
Weber fraction — a small example of reading the live posterior from experiment
code.

## Run it

Serve the repo statically and open:

```text
demos/size_discrimination/index.html
demos/size_discrimination/index.html?debug=1   # per-trial posterior/EIG panels + debrief overlay
```
