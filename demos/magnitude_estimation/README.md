# Magnitude-estimation (Stevens power law) ADO demo

The first **continuous-response** ADO demo (issue #110). A blue disk of a given area
is shown and the participant estimates its perceived size on a continuous slider; the
adaptive loop fits Stevens' power law and recovers the perceptual exponent.

The task uses the stock `canvas-slider-response` plugin (no custom plugin or asset),
loaded from a pinned CDN (see the page `<head>`), and the same shared experiment shell
as the other demos. Presentation and the design grid live in the task package; the
likelihood lives in the model package.

## Model contract

`src/models/magnitude_estimation/model.js` is a continuous-response model:
instead of a probability vector it supplies a response **density**. In log-log space
the likelihood is Gaussian,

```text
log(estimate) ~ Normal(loga + b * log(s), sigma)
```

so the ADO engine scores each candidate magnitude `s` by integrating the predictive
density (expected information gain). Parameters: `loga` (log scale), `b` (the Stevens
exponent — the headline), `sigma` (log-scale noise). Because the log-log likelihood is
homoscedastic, the MI-optimal magnitudes are the **ends** of the range (D-optimal for a
slope); the loop concentrates there rather than doing interior adaptation.

## Response coding

The slider records a raw size estimate; the task's `responseToOutcome` logs it into the
log space the density lives in:

```js
responseToOutcome(design, estimate) => Math.log(estimate)
```

so the row's `choice` is `log(estimate)` and `choice_raw` is the raw slider value.
`buildData` logs the design magnitude `s` into `log_s` and passes the (already-log)
response through as `log_y`, guarding against non-finite values.

## URLs

Normal prototype:

```text
demos/magnitude_estimation/index.html
```

Fast mock-controller visual check (no WASM):

```text
demos/magnitude_estimation/index.html?controller=mock&simulate=visual&debug=1
```

Data-only simulation (fast; what the browser smoke runs):

```text
demos/magnitude_estimation/index.html?simulate=data-only&debug=1
```

Visual simulation:

```text
demos/magnitude_estimation/index.html?simulate=visual&debug=1
```

With `debug=1` the page prints per-trial design/selection/posterior summaries and shows
live posterior trajectories for `loga`, `b`, and `sigma`.
