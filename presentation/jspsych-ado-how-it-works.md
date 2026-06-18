# How jspsych-ado Works

## The adaptive loop

Every ADO experiment repeats the same four steps on each trial:

1. **Select** — scan the design grid and find the question that would reduce uncertainty about the participant's parameters the most (maximizing *mutual information*)
2. **Present** — show that question as an ordinary jsPsych trial
3. **Observe** — record the participant's response
4. **Update** — refit the statistical model to all responses so far, producing a new posterior

Because each question is chosen to be maximally informative, the posterior converges far faster than fixed or staircase designs — typically reaching high reliability in 20 trials instead of 60–100.

---

## What runs where

The adaptive loop needs real statistical inference between trials. jspsych-ado handles this without a server by compiling the Stan model to **WebAssembly** at setup time (using the Flatiron Institute's public Stan-to-WASM server). The compiled model is then loaded into a **Web Worker** — a background thread that runs NUTS sampling without blocking the page between trials.

```
Main thread                         Web Worker
──────────────────────────────      ──────────────────────────────────────
jsPsych shows the trial             (idle)
Participant responds
  → controller.update(trial_data) →
                                    Stan NUTS samples the posterior
                                    MI engine scans the design grid
                                  ← returns { next_design, post_mean, post_sd }
jsPsych shows the next trial
```

From the experiment page's perspective, the controller is just two `async` method calls — `start()` and `update()` — that happen to resolve quickly because the sampling runs off the main thread. The timeline, the task presentation, and the data logging never see Stan or WASM directly.

---

## The two things you provide

**A task** defines the design grid — the space of possible questions — and how to render each question as a stimulus:

```js
// What questions are possible?
design_grid: { t_ss: [0], t_ll: [1, 4, 8, 26, 52], r_ss: [100, 400], r_ll: [800] }

// How to display one question:
makeStimulus: (design) => `<p>$${design.r_ss} now  vs.  $${design.r_ll}
                             in ${design.t_ll} weeks?</p>`
```

**A model** defines the Stan likelihood and a JS link function that maps parameters and a design to a choice probability. ADO uses the link function to compute expected information gain across the design grid; Stan uses the likelihood to update the posterior after each response.

Everything else — the adaptive loop, the Worker, the data logging, the jsPsych integration — is handled by the library.

---

## How the code is structured

```
jspsych-ado/
├── ado/
│   ├── ado_timeline.js     ← the generic jsPsych timeline (task- and model-agnostic)
│   ├── mi_engine.js        ← mutual-information design selection
│   └── stan_worker.js      ← Web Worker: runs Stan NUTS off the main thread
├── controllers/
│   ├── stan_ado_controller.js   ← wires the Worker + MI engine into start()/update()
│   └── mock_ado_controller.js   ← deterministic drop-in for development/testing
├── tasks/delay_discounting/     ← design grid + stimulus presentation
├── models/hyperbolic/           ← Stan source + compiled WASM + JS adapter
└── index.js                     ← jsPsychADO façade (registerTask, createTimeline, …)
```

The timeline calls the controller; the controller calls the Worker; the Worker calls Stan. Each layer is swappable independently — replacing the Stan controller with the mock controller (for UI development) or a future native engine requires no changes to the timeline or the experiment code.
