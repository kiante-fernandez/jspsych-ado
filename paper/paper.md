---
title: 'jspsych-ado: In-browser adaptive design optimization for jsPsych experiments'
tags:
  - JavaScript
  - jsPsych
  - Stan
  - WebAssembly
  - adaptive design optimization
  - Bayesian inference
  - psychophysics
authors:
  # TODO: confirm author ORDER, per-author affiliations, and the corresponding author.
  # Some names were given first-name-only — add full surnames where missing.
  - name: Brendan   # TODO: surname
    orcid: 0000-0001-9309-8497
    affiliation: 1
  - name: Ying   # TODO: surname
    orcid: 0009-0008-3743-372X
    affiliation: 1
  - name: Ludan   # TODO: surname
    orcid: 0009-0006-3578-8020
    affiliation: 1
  - name: Jordan Gunn
    orcid: 0009-0005-1024-6113
    affiliation: 1
  - name: Xiaohong   # TODO: surname (GitHub: xiaohong-cai)
    orcid: 0000-0002-8210-8386
    affiliation: 1
  - name: Kianté Fernandez
    orcid: 0000-0002-8493-880X
    corresponding: true
    affiliation: 1
affiliations:
  - name: TODO Institution, City, Country   # TODO: split into per-author affiliations
    index: 1
    # ror: 00000000   # optional
date: 17 June 2026
bibliography: paper.bib
---

<!--
JOSS paper. Target length 750–1750 words. paper.md is the single source — edit it
directly (Markdown). LaTeX math ($...$, $$...$$) is supported. Build the JOSS PDF
with the "Draft JOSS paper" GitHub Action (or locally; see paper/README.md).

Required JOSS sections (all present below): Summary, Statement of need,
State of the field, Software design, Research impact statement, AI usage disclosure.
Cite using bracketed bib keys (see paper.bib).
-->

# Summary

`jspsych-ado` brings *adaptive design optimization* (ADO) to browser-based behavioral
experiments built with jsPsych [@deleeuw2015jspsych]. After each response, a Bayesian
model written in Stan [@carpenter2017stan] — compiled to WebAssembly and run
client-side in a Web Worker — updates the posterior over the model parameters, and the
next stimulus is chosen to maximize the expected information it provides about those
parameters. The whole adaptive loop runs in the participant's browser: there is no
analysis server and no Python dependency, so an experiment remains a set of static
files that can be hosted on a platform such as JATOS or GitHub Pages. The design is
model- and stimulus-agnostic: a researcher supplies a Stan model, a link function, and
a stimulus renderer, and the same inference-and-design engine drives the experiment.

# Statement of need

Adaptive experiments present the most informative stimulus on each trial, recovering
parameters faster and with fewer trials than fixed designs — valuable when participant
time is scarce. Existing general ADO tooling (notably ADOpy [@yang2020adopy]) is
Python- and server-side, which is awkward to deploy for online data collection where
the experiment runs in the browser. `jspsych-ado` fills this gap with a browser-native,
jsPsych-integrated ADO loop.
<!-- TODO: expand with the concrete use cases and who benefits. -->

# State of the field

General ADO is implemented in ADOpy [@yang2020adopy], building on a mutual-information
formulation of optimal design [@cavagnaro2010adaptive]. Domain-specific adaptive
methods are widely used in psychophysics — QUEST+ [@watson2017questplus] and Psi — and
have been brought online (e.g. PyBOLE [@myrodia2026pybole]). Running Stan in the browser
via WebAssembly was recently demonstrated by stan-playground [@stanplayground], but for
general MCMC rather than adaptive design. `jspsych-ado` combines in-browser Stan
inference with mutual-information design optimization inside the jsPsych ecosystem.
<!-- TODO: position against Gaussian-process active learning [@gpactivelearning]. -->

# Software design

The package separates a model-agnostic ADO engine from per-model packages. The engine
estimates the posterior from Stan draws and scores candidate designs by mutual
information; a model package supplies the Stan program, a JavaScript link function (the
same likelihood the engine and a simulated participant use), a design space, and a
stimulus renderer. Stan models are compiled to WebAssembly with the stan-playground
compile server [@stanplayground; @zakai2011emscripten] and the compiled artifact runs
in a Web Worker so sampling never blocks the interface.

Key trade-offs: committing the compiled WebAssembly (self-contained, offline-capable)
versus compiling on study setup (arbitrary user models, but needs a reachable compile
server); a discrete candidate design grid versus continuous design optimization; and a
current focus on binary-response models.

<!--
PLACEHOLDER — public interface. The researcher-facing API (model registration and
timeline construction) is still being finalized (see issue #29), so this paper does
NOT yet commit to specific syntax. Fill in the concrete walkthrough once it lands.
-->

# Example: adaptive numerosity discrimination

<!-- OUTLINE + stable math only for now; the concrete code/interface walkthrough is a
placeholder pending the finalized API (#29). -->
We illustrate the workflow with a numerosity (numeric discrimination) task
[@halberda2008individual]: on each trial two dot arrays are shown and the participant
judges which is more numerous. A psychometric function maps the numerosity ratio to the
probability of a correct response; ADO chooses the next ratio to maximize the
information gained about the participant's acuity (e.g. their Weber fraction).

With responses $y_{1:t}$ collected under designs $d_{1:t}$, Stan samples the posterior
over parameters $\theta$:
$$ p(\theta \mid y_{1:t}) \;\propto\; p(\theta)\,\prod_{i=1}^{t} p(y_i \mid d_i, \theta). $$
For a binary response, the model specifies $p(Y = 1 \mid d, \theta)$ (here, a
logistic/Weber psychometric function of the ratio). The next design maximizes the
expected information gain — the mutual information between the response and the
parameters — estimated by Monte Carlo over the posterior draws $\theta^{(s)}$:
$$ d^{*} = \arg\max_{d}\; I(Y;\Theta \mid d)
        = H\!\big(\bar{p}_d\big) - \frac{1}{S}\sum_{s=1}^{S} H\!\big(p(Y\mid d,\theta^{(s)})\big),
\qquad \bar{p}_d = \frac{1}{S}\sum_{s=1}^{S} p(Y\mid d,\theta^{(s)}), $$
where $H$ is the binary entropy. This is exactly what the engine's design-selection
routine computes from the posterior draws.

<!-- PLACEHOLDER — model-registration + timeline code walkthrough (pending #29 API). -->
<!-- TODO — figure: example posterior / parameter-recovery trajectory (paper/figures/). -->

# Research impact statement

<!-- TODO: cite worked examples (delay discounting [@ahn2020rapid], numerosity
[@halberda2008individual]), reproducible tutorial materials, and readiness for the
jsPsych community. -->

# AI usage disclosure

<!-- TODO: disclose accurately. The repository history includes AI-assisted development
and documentation commits; state the extent of AI use in the software, documentation,
and authoring of this paper. -->

# Acknowledgements

<!-- TODO: funding and contributions. -->

# References
