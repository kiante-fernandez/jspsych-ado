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

`jspsych-ado` brings browser-native *adaptive design optimization* (ADO) to behavioral experiments built with jsPsych [@deleeuw2015jspsych].
After each response, a Bayesian model written in Stan [@carpenter2017stan] --- compiled to WebAssembly and run client-side in a Web Worker --- updates the posterior over the model parameters, and the next stimulus is chosen to maximize the expected information it provides about those parameters.
Because the ADO runs entirely in the participant's browser, experiments can be deployed as static web assets rather than server-backed applications.
The package separates task presentation, response-model specification, and adaptive control so that new tasks, models, and algorithms can be implemented without rewriting the inference-and-design engine.

# Statement of need

Many behavioral experiments present stimuli on a fixed schedule, even though some trials are more informative than others for estimating a model's parameters or discriminating between competing theoretical accounts.
Adaptive design optimization (ADO) removes this inefficiency by treating stimulus selection as a sequential Bayesian design problem: after each response, the experimenter updates a posterior over the parameters of a model of the participant and presents the design expected to yield the most information about them [@cavagnaro2010adaptive; @myung2013tutorial].
For example, in delay discounting, if a participant accepts a delayed reward, ADO adjusts the amounts and delays of the next offer to better estimate the discount rate.
Data collection efficiency increases, as ADO has been shown to reach test-retest reliabilities of 0.95 or higher within 10-20 trials and to be three to eight times more efficient than a conventional staircase [@ahn2020rapid].
Comparable benefits have been reported for risky-choice model discrimination, menmonic-similarity testing, and psychophysical threshold estimation [@cavagnaro2012optimal; @watson2017questplus], making ADO valuable wherever participant time and attention is scarce [@ahn2020rapid; @cavagnaro2012optimal; @villarreal2022adaptive].

These conditions are most salient in online data collection, which is also where ADO is difficult to use.
Browser-based platforms such as jsPsych have made large-scale online experiments routine, with response-contingent timelines, reusable plugins, and simulation tools for validating experiment logic [@deleeuw2015jspsych; @deleeuw2023jspsych].
Currently, jsPsych does not provide a model-based ADO feature.
The response model, posterior update, and information-based stimulus selection must be supplied for each adaptive study.
Existing ADO software runs the statistical estimation for ADO outside the browser [@yang2021adopy], so an online experiment must reach a server between trials --- reintroducing the hosting, latency, and data-governance burdens many browser-native experiments.
In practice, researchers are responsible for either setting up the server infrastructure or writing code that is difficult to reuse, inspect, and validate across tasks.

`jspsych-ado` targets applied researchers who want to run an adaptive task without building an inference pipeline, and methodologists who want to develop new adaptive tasks and models.
It runs the entire ADO loop in the participant's browser, with no Python and no server.
A Bayesian model written in Stan [@carpenter2017stan] is compiled to WebAssembly and sampled client-side in a Web Worker, and the next design is chosen by maximizing mutual information over a candidate grid.
The package separates the task, the response model, and the adaptive controller, so a researcher can supply a custom Stan model and likelihood and obtain an adaptive experiment without modifying the inference-and-design engine.
Because the result is a set of static web assets, adaptive experiments can be deployed on standard hosting and recruitment platforms alongside ordinary jsPsych studies.
This makes `jspsych-ado` well suited to settings where brief, reliable measurement is essential, such as in clinical and individual-differences studies that draw on patient or population samples, and automated or remote assessments must be run efficiently and at scale.

# State of the field

Adaptive design optimization belongs to the broader framework of Bayesian experimental design, which uses a model of the process under study to identify maximally informative designs [@cavagnaro2010adaptive; @rainforth2024modern; @huan2024optimal].
Given a model $p(\theta)\,p(y \mid d, \theta)$ with parameters $\theta$, prior $p(\theta)$, and a data model $p(y \mid d, \theta)$ relating the response $y$ to the design $d$, the optimal design $d^{*}$ maximizes the expected information gain (EIG) --- the expected reduction in entropy from the prior to the posterior:

$$d^{*} = \arg\max_{d}\; \mathrm{EIG}(d),
\qquad
\mathrm{EIG}(d)
  = \mathbb{E}_{p(y \mid d)}\!\Big[\, H\big(p(\theta)\big) - H\big(p(\theta \mid y, d)\big) \,\Big],
\label{eq:eig}$$

where $H(\cdot)$ is the Shannon entropy and the expectation is over the prior predictive $p(y \mid d) = \int p(y \mid d, \theta)\,p(\theta)\,\mathrm{d}\theta$.
Methods of this kind are applied across the behavioral and biomedical sciences, including psychophysics [@watson2017questplus], cognitive modeling [@myung2013tutorial], computational psychiatry [@kwon2023adaptive], cognitive neuroimaging [@bahg2020real], and systems biology [@pauwels2014bayesian].

Several software tools make these methods usable, but each leaves the browser-native, model-general case unaddressed.
ADOpy provides a modular, grid-based Python implementation of ADO with reusable task, model, and engine components [@yang2021adopy], and the DARC toolbox offers Bayesian adaptive design for delayed and risky choice in MATLAB and Python [@vincent2017darc].
Both are general in the models they support but run in desktop scientific-computing environments; embedding them in an online experiment requires a server that the browser queries between trials.
The QUEST+ method, through its JavaScript port jsQuestPlus, runs adaptive psychophysical procedures in the browser, including under jsPsych [@watson2017questplus; @kuroki2022jsquestplus], but it is specialized to threshold and psychometric-function estimation rather than arbitrary user-specified models, and it performs inference over a precomputed grid rather than by general posterior sampling.

No existing tool combines execution within the browser with model-general, sampling-based ADO.
Running Stan in the browser via WebAssembly was demonstrated only recently [@stanplayground], and, to our knowledge, it has not previously been applied to adaptive design.
`jspsych-ado` fills this gap, utilizing full client-side posterior sampling with mutual-information design selection inside the jsPsych ecosystem.
Moreover, jspsych-ado lets researchers supply their own Stan model, in addition to choosing from a catalogue of models. This design supports adaptive measurement
across behavioral domains --- from value-based decisions under risk and ambiguity [@levy2010neural] to memory paradigms such as free recall [@manning2023feature] and the Mnemonic Similarity Task, for which ADO has already been developed [@villarreal2022adaptive] --- so that researchers studying memory, decision-making,
and individual differences can run efficient, reliable adaptive tasks without leaving the
browser. While ADOpy and DARC enable ADO within experiments, they are less amenable to being hosted on browsers for online experiments, and jsQuestPlus is architecturally committed to grid-based psychophysics. Thus, a jsPsych-native implementation was required. Models are compiled to WebAssembly once, ahead of data collection, so the deployed experiment depends only on static assets and performs its per-trial inference entirely on the participant's device.

# Software design

Figure [1](#fig:conceptual){reference-type="ref" reference="fig:conceptual"} summarizes the runtime loop implemented by `jspsych-ado`. On each trial, the controller scores candidate designs and selects the one expected to provide the most information. jsPsych then presents the selected design and records the participant's response. The inference backend uses the accumulated responses and registered model to update the posterior distribution over parameters. Candidate designs are the stimulus settings the controller can choose from, such as reward and delay values in a delay-discounting task.

![Conceptual loop implemented by `jspsych-ado`. Candidate designs are scored by expected information gain, the selected design is presented as a jsPsych trial, the participant's response is used to update the posterior, and the updated posterior informs the next design selection.](jspsych-ado-conceptual.png){#fig:conceptual width="0.75\\linewidth"}

Figure [2](#fig:code-block){reference-type="ref" reference="fig:code-block"} shows how this loop is exposed to users.
An experiment registers a task and a model, then calls `createTimeline` to construct the adaptive jsPsych timeline.
Tasks own the participant-facing pieces: candidate designs, display logic, response options, and response coding.
A model owns the statistical response process.
A controller connects the registered task and model, checks that their design variables and response spaces are compatible, and chooses designs during the experiment.
This separation lets researchers change the participant-facing task, the statistical model, or the adaptive policy independently.

The model package defines the statistical quantities that the controller needs for inference and design scoring.
The adaptive loop requires two statistical computations.
First, after each response, the system must update uncertainty about model parameters; this is Stan's role.
The registered Stan model is fit to the accumulated trial history, and the controller receives posterior draws from $p(\theta \mid D)$.
Second, the system must predict how a participant would respond to each candidate design under possible parameter values.
This is the role of the model's JavaScript `responseProb` or `responseProbs` function, which the controller evaluates over the design grid.
A model package therefore supplies parameter names and priors, Stan code or a compiled WebAssembly artifact, the data mapping from jsPsych trial rows to Stan input, and the JavaScript response-probability function.

The Stan controller scores each candidate design by the expected information
gain defined above, applied at every trial with the current posterior
$p(\theta \mid D)$ in place of the prior. Stan then supplies the posterior draws
$\theta^{(s)} \sim p(\theta \mid D)$, while the model's response-probability function supplies the likelihood $p(y \mid d, \theta)$. Because mutual information is only the entropy of the posterior-predictive response minus the expected entropy of the per-draw response, the controller evaluates the $\mathrm{EIG}(d)$ in a relatively sparse response space (binary or a few categories) making the computation inexpensive. It computes this over the task's finite design grid $\mathcal{G}$ and selects the highest-scoring design $d^{*}$ for the next trial.

Running posterior inference in the browser makes deployment simpler, but also sets practical limits on model complexity and per-trial update time.
Stan models must be compiled before they can run in the browser; models bundled with `jspsych-ado` include these compiled WebAssembly files.
Users developing new models can compile from Stan source during setup, including through the stan-playground compile server [@stanplayground; @zakai2011emscripten].
At runtime, sampling runs in a Web Worker so posterior updates do not block the participant-facing interface.
The current implementation therefore targets browser-feasible Stan models, finite design grids, and finite binary or categorical response spaces rather than continuous online design optimization.

The same interfaces also support validation.
Simulated participants and the mutual-information engine call the same JavaScript response-probability function, so browser simulation can exercise the same jsPsych timeline used in a live experiment without maintaining a separate data generator.
The resulting recovery, parity, and browser-level checks are discussed below as evidence of research impact.

# Example: adaptive numerosity discrimination

![Minimal `jspsych-ado` workflow. Users register a task that defines the stimuli and responses, register a model that defines the statistical response process, and create an adaptive jsPsych timeline from the paired task and model.](jspsych-ado-code_block.png){#fig:code-block width="1\\linewidth"}

We will now explain the details using a numerosity (numeric) discrimination task, following @halberda2008individual, which ships with the package as a ready-to-run task/model pair. In this example there is a single stimulus parameter controling the numerosity ratio of the two dot arrays and denoted by the design $d$ and a single model parameter, the Weber fraction $\theta = w$ (a participant's approximate-number-system acuity). A cumulative-normal (probit) function $\Phi$ is assumed to be the psychometric function, and the task is two-alternative forced choice (the participant judges which color is more numerous), giving a binary response $y$. Using the ADO method, the Weber fraction can be estimated, with the next dot pair $d^{*}$ on each trial
chosen to maximize the expected information gain about $w$.

After $t$ trials, the accumulated dataset is $D = \{(d_i, y_i)\}_{i=1}^{t}$, and Stan samples the posterior over $\theta$:
$$p(\theta \mid D) \;\propto\; p(\theta)\,\prod_{i=1}^{t} p(y_i \mid d_i, \theta).$$
The probit psychometric function gives the probability of a correct response as
$$p(Y = 1 \mid d, \theta)
  = \Phi\!\left(\frac{n_{\text{large}} - n_{\text{small}}}
                     {w\,\sqrt{n_{\text{large}}^{2} + n_{\text{small}}^{2}}}\right),$$
where $n_{\text{large}}$ and $n_{\text{small}}$ are the larger and smaller dot
counts in design $d$. The next design then maximizes the $\mathrm{EIG}(d)$, evaluated under the current posterior $p(\theta \mid D)$ and estimated by Monte Carlo over the posterior draws $\theta^{(s)} \sim p(\theta \mid D)$:
$$d^{*} = \arg\max_{d \in \mathcal{G}}\; I(\Theta; Y \mid d, D)
        = H\!\big(\bar{p}_d\big)
          - \frac{1}{S}\sum_{s=1}^{S} H\!\big(p(Y \mid d, \theta^{(s)})\big),
  \qquad
  \bar{p}_d = \frac{1}{S}\sum_{s=1}^{S} p(Y \mid d, \theta^{(s)}),$$
where $\bar{p}_d$ is the Monte-Carlo estimate of the posterior-predictive response probability $p(Y \mid d, D)$. This is exactly what the engine's design-selection routine computes from the posterior draws.

# Research impact statement

Because the nontrivial technical skills required to use ADO have been a barrier to its wider adoption, we believe jsPsych-ADO will positively impact the integration of adaptive designs across a broader range of tasks in the social and behavioral sciences.
It lowers the barrier to entry for including an adaptive version of a task by eliminating the need to write bespoke adaptive design code, while offering implementations across a range of existing tasks and computational models used in prior work on adaptive designs, such as delay discounting [@lee2026rapid] and numeric discrimination [@halberda2008individual].
Further, it enhances collaboration by providing researchers with a shared scaffold for developing and sharing new adaptive designs within a common ecosystem (i.e., jsPsych).
We aim to continue developing jsPsych-ADO and extend its capabilities beyond those of existing implementations for adaptive experimental design.

# AI usage disclosure

Generative AI tools were used during the development of jspsych-ado. Claude Code and OpenAI Codex assisted with code implementation, automating the release workflow, and providing code reviews during pull requests. All AI-generated content was reviewed and edited by the authors to ensure accuracy and clarity.

# Acknowledgements

We thank the jsPsych Summer Hackathon participants for their support and feedback.
We also thank the National Science Foundation under Award 2346214 for supporting the Hackathon.

# References
