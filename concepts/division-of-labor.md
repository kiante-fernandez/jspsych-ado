# Division of labor

Adaptive jsPsych experiments work best when the browser timeline and the adaptive inference code have clearly separate jobs.

The browser experiment does not fit the model. It presents trials, records the participant's response, and sends the design/response pair to an adaptive controller.

The adaptive controller owns the adaptive step. Given the design that was shown and the response that was observed, it returns the updated adaptive state and the next design to show.

A useful way to read the loop is:

```text
jsPsych:
  "Here is the design I showed, and here is the participant's response."

Adaptive controller:
  "Given that observation, here is the updated adaptive state and the next design."

jsPsych:
  "Okay, I will show that next design."
```

## Delay discounting example

In the delay discounting demo, the design is an SS/LL reward offer and the response is the participant's SS/LL choice.

In `stan` mode (the live path), the adaptive controller runs entirely in the browser. A Stan model compiled to WebAssembly updates the posterior over `k` and `tau` from the accumulated choices, summarizes that posterior, and the mutual-information engine chooses the next SS/LL offer from the design grid. No server is involved.

In mock mode, the browser uses a deterministic stand-in controller with the same `start()`/`update()` interface. This lets the jsPsych timeline be reviewed without loading WASM, but the mock posterior values are not real inference.

## Why the boundary matters

This separation keeps the experiment code focused on presentation and response collection. The timeline does not need to know how the adaptive controller computes likelihoods, updates posteriors, or chooses designs.

It also makes development easier. A new experiment can be wired against a mock controller first, then switched to the real Stan-backed controller once the trial flow and data fields are clear.

The shared contract is small:

- `start(context)` returns the first design and any initial adaptive state
- `update(trial_data)` returns the updated adaptive state and the next design

As long as each controller satisfies that contract, the same jsPsych timeline can run against mock data or live in-browser Stan inference.
