# Paper

The manuscript for `jspsych-ado`, intended for the
[Journal of Open Source Software](https://joss.theoj.org/). It doubles as a tutorial:
a worked numeric-discrimination (numerosity) example with a psychometric function, the
general adaptive-design interface, and the math of Bayesian adaptive design.

Lives on the dedicated **`joss`** branch (the convention used by, e.g., stan-playground).

## Source vs. generated

You **author in LaTeX** (Overleaf); the JOSS **Markdown is generated** from it.

- `body.tex` — **the prose you edit** (sections, math, `\citep`). The main writing surface.
- `paper.tex` — LaTeX wrapper (title, authors+ORCIDs, metadata sidebar, footer) that
  `\input{body}`. Uses `joss.cls`. Compile this for the styled PDF.
- `joss.cls` — an **unofficial JOSS-style** class (logo header, left metadata sidebar,
  sans headings, footer citation). It *approximates* the JOSS look so we can draft in
  LaTeX; JOSS has no official LaTeX class.
- `frontmatter.yaml` — JOSS metadata (title, authors, ORCIDs, affiliations, tags) for
  the generated `paper.md`. (Keep its author list in sync with `paper.tex`.)
- `logo.png`, `paper.bib`, `figures/`.
- `paper.md` — **generated** from `body.tex` + `frontmatter.yaml` by `build-md.sh`.
  **Do not hand-edit it** — CI overwrites it on every push.

## Editing / Overleaf

Write in `body.tex`; touch `paper.tex`/`frontmatter.yaml` for metadata. The LaTeX
compiles with **pdfLaTeX** (default, incl. Overleaf); use **LuaLaTeX/XeLaTeX** with the
[Hack font](https://github.com/source-foundry/Hack) for the exact JOSS mono. To sync
this branch with Overleaf, use its Git integration (single `main` branch) via a local
intermediary repo, mapping `joss` ↔ Overleaf `main` with refspecs.

## Generating `paper.md`

`paper.md` is regenerated from the LaTeX, so it always tracks the source:

- **Automatically in CI:** every push touching the paper runs the **Build paper** Action,
  which regenerates `paper.md` (pandoc) and commits it back.
- **Locally:** `bash paper/build-md.sh` (needs `pandoc`).

## Previewing the PDF

- **Locally:** `cd paper && latexmk -pdf paper.tex` → `paper.pdf`.
- **CI:** the **Build paper** Action also uploads `paper.pdf` as an artifact (Actions
  run → Artifacts → `paper`).

## Submitting to JOSS

JOSS compiles **`paper.md`** with its Open Journals (Inara) pipeline — `joss.cls` here
is only a drafting approximation, not the official style. `paper.md` is already in the
right shape (YAML header + sections + `[@key]` citations), so submission is: point JOSS
at this repo/branch; the official styled PDF is produced by Inara.

## Keep in mind

- Length: **750–1750 words**.
- Required sections (all in `body.tex`): Summary, Statement of need, State of the field,
  Software design, Research impact statement, AI usage disclosure.
- The public `registerModel`/`createTimeline` interface (issue #29) is **not yet
  finalized**, so the Software-design and Example sections are outlines.
- `TODO`s: author surnames/order/affiliations, corresponding author, a few `VERIFY` bib
  entries, and the Overleaf link.
