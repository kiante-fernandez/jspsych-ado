# Security Policy

## Supported versions

`jspsych-ado` is pre-1.0; security fixes land on `main` and in the latest published release.

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability.

Instead, report it privately via GitHub's [private vulnerability reporting](https://github.com/jspsych/jspsych-ado/security/advisories/new) (the **Security → Report a vulnerability** tab on this repository). We will acknowledge your report and work with you on a fix and coordinated disclosure.

For non-sensitive bugs, use the [issue tracker](https://github.com/jspsych/jspsych-ado/issues).

## Scope notes

This library runs Adaptive Design Optimization entirely client-side and ships a Stan model compiled to WebAssembly (vendored under `core/tinystan/`, with per-model provenance in each `models/<name>/PROVENANCE.md`). There is no server component. The committed `.wasm` artifacts are a deliberate design choice; see `CONTRIBUTING.md` ("Working with Stan and WASM") for how they are built and verified.
