# Delay discounting

An ADOpy-style delay discounting experiment whose adaptive inference runs entirely
in the browser with a Stan model compiled to WebAssembly.

The timeline is separated from the adaptive backend by a small controller contract
(`start(context)` / `update(trial_data)`):

- `delay_discounting_timeline.js` displays trials and records data.
- `controllers/stan_ado_controller.js` — the live path: Stan (WASM, in a Web Worker)
  infers the posterior over `k`/`tau`; the generic engine picks the next design by
  mutual information.
- `controllers/mock_ado_controller.js` — deterministic stand-in so the timeline can
  run without loading WASM.

Layout:

- `ado/mi_engine.js` — model-agnostic mutual-information design optimization + prior draws.
- `ado/stan_worker.js` — generic Web Worker that runs NUTS off the main thread.
- `models/<name>/` — self-contained model packages (`.stan` + compiled `main.js`/`main.wasm`
  + `model.js` adapter). See [models/README.md](models/README.md).
- `dd_config.js` — `grid_design`, the `stan` sampler settings, and simulation config.
- `dd_simulation.js` — simulated participant (shares the model adapter's likelihood).

Debug visualizations:

When `debug=1` is present in the URL, the browser console prints a trace after each
adaptive update and the page shows a compact SVG information-gain panel. The console
trace includes:

- Posterior histograms for every estimated model parameter returned by the current
  model adapter. For the hyperbolic model this means `k` and `tau`; future models
  are plotted generically from their posterior draw keys. The y-axis is the number
  of posterior draws in each bin. `k` is plotted on `log10(k)` because plausible
  discount rates span orders of magnitude; other parameters are plotted on their
  native scale.

The on-page debug panel plots two connected lines from trial 1 through the current
trial:

- Expected max MI: the maximum mutual information of the ADO-selected stimulus shown on
  each trial.
- Realized IG: the information gain computed after each response from the pre-trial
  posterior/prior draws and the observed choice, so it shows how much the actual response
  updated the model.

In this task, a stimulus is one smaller-sooner/larger-later offer. For every candidate
stimulus in the design grid, ADO estimates how informative the next binary choice would
be under the current posterior. A stimulus has high mutual information when plausible
posterior draws predict meaningfully different choices, especially when those draws are
confident. The chosen stimulus is the candidate with the largest score.

Adaptive stopping:

The Stan controller returns `eig`, the expected information gain of the chosen next
design. This is the same value as the selected design's mutual information, so no
separate scoring machinery is needed for stopping. The jsPsych task is a looping
`[choice, update]` timeline and stops when the controller's latest state has
`should_stop: true`.

The computation path is:

1. `stan_ado_controller.js` stores prior draws at startup and posterior draws after
   each Stan sample.
2. `enumerateDesigns(...)` turns `grid_design` into every candidate offer.
3. `selectOptimalDesign(...)` scores each candidate with `mutualInfo(...)`.
4. For a candidate design `d`, `mutualInfo(...)` calls the model's
   `choiceProbLL(d, draw_s)` for every draw `s`.
5. The score is `H(mean_s p_s) - mean_s H(p_s)`, where `p_s` is the predicted LL
   choice probability under draw `s` and `H` is binary entropy in nats.
6. The selected design's `mutual_info` is copied to the controller state as `eig`.
7. `evaluateStoppingState(...)` compares that best-design `eig` with
   `stopping.eig_tolerance` after the min-trial gate.

`eig`/mutual information is the expected learning before the next response.
`realized_information_gain` is the actual learning after the observed response, so
it can be higher or lower than `eig` on any single trial.

Configure the rule in `dd_config.js`:

- `stopping.min_trials`: the EIG criterion may not fire before this many choices.
- `stopping.max_trials`: hard safety cap.
- `stopping.eig_tolerance`: stop when `eig < eig_tolerance`.

EIG is measured in nats; the maximum for a binary response is `ln(2)`, about `0.693`.
The default `eig_tolerance: 0.08` is a reasonable starting point and should be tuned
with simulation.

As trials proceed, the posterior distributions should usually narrow around the
participant's likely parameters. When that happens, fewer candidate stimuli can separate
the remaining plausible parameter values, so the max-information-gain trace typically
declines or flattens. It does not have to decrease monotonically: a surprising response,
posterior shift, sampler variability, or a newly informative region of the design grid can
make the trace bump upward. Broad or multimodal posterior histograms tend to coincide with
higher available information; concentrated histograms tend to coincide with lower
remaining information. The realized information gain can be above or below the expected
max mutual information on any single trial because the participant's actual response may
be more or less surprising than average under the pre-trial posterior.

Interpretation notes:

- The posterior histogram y-axis counts posterior draws per bin. Broad or multimodal
  histograms mean plausible parameter values are still spread out; narrow histograms mean
  the model is concentrating on a smaller region of parameter space.
- Plausible parameter values "disagree" about a stimulus when different posterior draws
  predict different choices for the same offer. For example, low-`k` draws may predict LL
  while high-`k` draws predict SS.
- Max mutual information is the expected learning before the response. It is high when
  the selected stimulus separates plausible parameter values into different predicted
  responses.
- Realized information gain is the actual posterior update after the response. Draws that
  predicted the observed choice are upweighted; draws that made the observed choice
  unlikely are downweighted.

Response coding:

- `choice = 0`: smaller-sooner option
- `choice = 1`: larger-later option (`y` in the Stan model)
