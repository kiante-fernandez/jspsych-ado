# Future Directions

jspsych-ado is working and tested, but deliberately scoped. Here is where it goes next.

---

## 1. Validation against ADOpy

Before a methods paper can be submitted, the browser engine needs to be proven correct against the Python reference implementation. The plan is a deterministic parity harness: feed an identical sequence of (design, response) pairs to both ADOpy and jspsych-ado and assert that the posteriors and selected designs match within tolerance. Alongside that, simulated-participant recovery — generating synthetic participants with known parameters and confirming the engine recovers them — will benchmark efficiency against the Ahn et al. (2020) results.

## 2. Packaging and distribution

The current codebase is a working experiment, not yet a distributable library. The next packaging step is to extract the timeline into a proper npm package (`jspsych-delay-discounting`) following the `jspsych-timelines` conventions — exporting `createTimeline`, `timelineUnits`, and `utils` — and submit it to `jspsych-contrib`. This makes the tool a one-line install for any jsPsych researcher rather than a repo to clone.

## 3. Additional tasks and models

The engine is already task- and model-agnostic. Adding a new task requires only a design grid and a stimulus function; adding a new model requires a Stan likelihood and a JS link function. The natural next targets, both already specified in ADOpy, are choice under risk and ambiguity (CRA) and 2AFC psychometric functions (psi). Either could become a second validated example in the paper.

## 4. Model discrimination

The current engine estimates parameters. A second objective — choosing designs that distinguish between competing models (e.g., hyperbolic vs. exponential discounting) rather than just estimating within one — is theoretically grounded in Cavagnaro et al. (2010) and is a direct extension of the mutual-information machinery already in place.

## 5. Methods paper

The target venue is *Behavior Research Methods*, where both ADOpy (Yang et al., 2020) and jsQuestPlus (Kuroki & Pronk, 2022) were published. The empirical core will be the parity results, the simulated-participant recovery curves, and cross-browser timing benchmarks — demonstrating that the browser-native implementation is both correct and fast enough for real online use.
