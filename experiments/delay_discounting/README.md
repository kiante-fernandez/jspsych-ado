# Delay discounting

An ADOpy-style delay discounting experiment whose adaptive inference runs entirely
in the browser with a Stan model compiled to WebAssembly.

This experiment is a **thin consumer** of the general [`jspsych-ado/`](../../jspsych-ado)
package. `index.html` registers the hyperbolic model and asks the `jsPsychADO` façade
to build the adaptive timeline:

```js
import { jsPsychADO } from "./jspsych-ado/index.js";
import hyperbolicModel from "./jspsych-ado/models/hyperbolic/model.js";

jsPsychADO.registerModel("hyperbolic", { /* prior, params, design_grid, linkProb,
  toStanData, presentation, choices, ... — all from the model package */ });
const timeline = jsPsychADO.createTimeline(jsPsych, { model: "hyperbolic" }, run_context);
```

What lives where:

- **All adaptive machinery is in `jspsych-ado/`** — the MI engine, the in-browser
  Stan controller + Web Worker, the generic timeline, and the façade. None of it is
  delay-discounting-specific.
- **The hyperbolic model package** (`jspsych-ado/models/hyperbolic/`) owns the
  likelihood (`choiceProbLL`/`.stan`), the priors, and the **presentation** (the
  SS/LL option cards, the S/L keymap, the prompt).
- **This folder** holds only experiment-level config and the page:
  - `dd_config.js` — `grid_design`, the `stan` sampler settings, and simulation config.
  - `index.html` — registers the model and runs the timeline (`?controller=stan`
    live inference, `?strategy=ado|random` design policy,
    `?controller=mock` deterministic dev path, `?simulate=…` simulated participants).

Response coding:

- `choice = 0`: smaller-sooner option
- `choice = 1`: larger-later option (`y` in the Stan model)
