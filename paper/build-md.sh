#!/usr/bin/env bash
# Generate paper.md (the JOSS submission artifact) from the LaTeX source.
#
# Source of truth is the LaTeX: body.tex (prose) + frontmatter.yaml (JOSS metadata).
# This converts body.tex -> Markdown with pandoc (\citep -> [@key], math -> $...$,
# \section -> #) and prepends the YAML header. CI runs this on every push so paper.md
# always tracks the .tex. Do not hand-edit paper.md.
#
# Usage:  paper/build-md.sh        (needs pandoc)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

body="$(pandoc body.tex --from latex --to markdown --wrap=preserve --markdown-headings=atx)"

{
  echo "---"
  cat frontmatter.yaml
  echo "---"
  echo
  echo "<!-- GENERATED from paper.tex/body.tex by paper/build-md.sh — do not edit by hand. -->"
  echo
  printf '%s\n' "$body"
  echo
  echo "# References"
} > paper.md

echo "wrote paper.md ($(wc -w < paper.md | tr -d ' ') words)"
