---
# JOSS metadata for the generated paper.md. build-md.sh wraps this in --- delimiters
# and prepends it to the pandoc-converted body.tex. (The LaTeX PDF gets author info
# from paper.tex; keep the two author lists in sync.)
# Author order: co-authors alphabetical by surname; Kianté Fernandez last & corresponding.
# Names resolved from ORCID records. TODO: per-author affiliations.
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
  - name: Xiaohong Cai
    orcid: 0000-0002-8210-8386
    affiliation: 1
  - name: Jordan Gunn
    orcid: 0009-0005-1024-6113
    affiliation: 1
  - name: Brendan Lam
    orcid: 0000-0001-9309-8497
    affiliation: 1
  - name: Ludan Yuan
    orcid: 0009-0006-3578-8020
    affiliation: 1
  - name: Ying Zeng
    orcid: 0009-0008-3743-372X
    affiliation: 1
  - name: Kianté Fernandez
    orcid: 0000-0002-8493-880X
    corresponding: true
    affiliation: 1
affiliations:
  - name: TODO Institution, City, Country
    index: 1
date: 17 June 2026
bibliography: paper.bib
---

<!-- GENERATED from paper.tex/body.tex by paper/build-md.sh — do not edit by hand. -->

# Summary

`jspsych-ado` brings *adaptive design optimization* (ADO) to browser-based
behavioral experiments built with jsPsych [@deleeuw2015jspsych]. After each
response, a Bayesian model written in Stan [@carpenter2017stan] --- compiled to
WebAssembly and run client-side in a Web Worker --- updates the posterior over the
model parameters, and the next stimulus is chosen to maximize the expected information
it provides about those parameters. The whole adaptive loop runs in the participant's
browser: there is no analysis server and no Python dependency, so an experiment remains
a set of static files that can be hosted by any ordinary static web server.
The design is model- and stimulus-agnostic: a researcher supplies a Stan model, a link
function, and a stimulus renderer, and the same inference-and-design engine drives the
experiment.

# Statement of need

Adaptive experiments present the most informative stimulus on each trial, recovering
parameters faster and with fewer trials than fixed designs --- valuable when participant
time is scarce. Existing general ADO tooling (notably ADOpy [@yang2020adopy]) is
Python- and server-side, which is awkward to deploy for online data collection where the
experiment runs in the browser. `jspsych-ado` fills this gap with a
browser-native, jsPsych-integrated ADO loop.

# State of the field

General ADO is implemented in ADOpy [@yang2020adopy], building on a
mutual-information formulation of optimal design [@cavagnaro2010adaptive].
Domain-specific adaptive methods are widely used in psychophysics --- QUEST+
[@watson2017questplus] and Psi --- and have been brought online (e.g. PyBOLE
[@myrodia2026pybole]). Running Stan in the browser via WebAssembly was recently
demonstrated by stan-playground [@stanplayground], but for general MCMC rather than
adaptive design. `jspsych-ado` combines in-browser Stan inference with
mutual-information design optimization inside the jsPsych ecosystem.

# Software design

The package separates a model-agnostic ADO engine from per-model packages. The engine
estimates the posterior from Stan draws and scores candidate designs by mutual
information; a model package supplies the Stan program, a JavaScript link function (the
same likelihood the engine and a simulated participant use), a design space, and a
stimulus renderer. Stan models are compiled to WebAssembly with the stan-playground
compile server [@stanplayground; @zakai2011emscripten] and the compiled artifact
runs in a Web Worker so sampling never blocks the interface.

Key trade-offs: committing the compiled WebAssembly (self-contained, offline-capable)
versus compiling on study setup (arbitrary user models, but needs a reachable compile
server); a discrete candidate design grid versus continuous design optimization; and a
current focus on binary-response models.

# Example: adaptive numerosity discrimination

We illustrate the workflow with a numerosity (numeric discrimination) task
[@halberda2008individual]: on each trial two dot arrays are shown and the
participant judges which is more numerous. A psychometric function maps the numerosity
ratio to the probability of a correct response; ADO chooses the next ratio to maximize
the information gained about the participant's acuity (e.g. their Weber fraction).

With responses $y_{1:t}$ collected under designs $d_{1:t}$, Stan samples the posterior
over parameters $\theta$:
$$p(\theta \mid y_{1:t}) \;\propto\; p(\theta)\,\prod_{i=1}^{t} p(y_i \mid d_i, \theta).$$
For a binary response, the model specifies $p(Y = 1 \mid d, \theta)$ (here, a
logistic/Weber psychometric function of the ratio). The next design maximizes the
expected information gain --- the mutual information between the response and the
parameters --- estimated by Monte Carlo over the posterior draws $\theta^{(s)}$:
$$d^{*} = \arg\max_{d}\; I(Y;\Theta \mid d)
        = H\!\big(\bar{p}_d\big) - \frac{1}{S}\sum_{s=1}^{S} H\!\big(p(Y\mid d,\theta^{(s)})\big),
  \qquad \bar{p}_d = \frac{1}{S}\sum_{s=1}^{S} p(Y\mid d,\theta^{(s)}),$$
where $H$ is the binary entropy. This is exactly what the engine's design-selection
routine computes from the posterior draws.

# Research impact statement

# AI usage disclosure

# Acknowledgements

# References
