# JOSS paper

This folder holds the [Journal of Open Source Software](https://joss.theoj.org/)
submission for `jspsych-ado`. The paper doubles as a tutorial: a worked
numeric-discrimination (numerosity) example with a psychometric function, the
general adaptive-design interface, and the math of Bayesian adaptive design.

The paper lives on the dedicated **`joss`** branch (the convention used by, e.g.,
stan-playground), not on `main`.

## Files

- `paper.md` — the manuscript and **single source of truth** (Markdown; this is what
  JOSS compiles). Edit it directly; LaTeX math (`$...$`, `$$...$$`) is supported.
- `paper.bib` — BibTeX references (sources from issue #35; some marked `VERIFY`/`TODO`).
- `figures/` — figures referenced from `paper.md`.

## Drafting

> **Overleaf draft:** TODO — paste the share link here.

Write directly in `paper.md`. JOSS metadata (authors, ORCIDs, affiliations) lives in the
YAML header at the top. If collaborating on Overleaf, keep it as a Markdown/text file
there (Overleaf compiles LaTeX, so it won't render the JOSS PDF — use the previews below).

## Previewing the JOSS-styled PDF

- **CI (no local setup):** any push touching `paper/` runs the **Draft JOSS paper**
  GitHub Action (`.github/workflows/draft-paper.yml`), which renders `paper.md` with the
  Open Journals (Inara) pipeline and uploads `paper.pdf` as an artifact (Actions run →
  Artifacts → `paper`). Also runnable via "Run workflow".
- **Local (optional, no Docker):** with `pandoc` + a LaTeX engine + the
  [Hack font](https://github.com/source-foundry/Hack) installed, clone
  [openjournals/inara](https://github.com/openjournals/inara) and run
  `JOURNAL=joss make pdf ARTICLE="$PWD/paper/paper.md"` (output in
  `inara/publishing-artifacts/paper.pdf`).

## Requirements to keep in mind

- Length: **750–1750 words**.
- Required sections (all stubbed in `paper.md`): Summary, Statement of need, State of
  the field, Software design, Research impact statement, AI usage disclosure.
- The public `registerModel`/`createTimeline` interface (issue #29) is **not yet
  finalized**, so the Software-design and Example sections are present as outlines — fill
  the concrete interface walkthrough once the API lands.
