# Releasing

Releases are published to npm automatically by
[`.github/workflows/release.yml`](.github/workflows/release.yml) when a `vX.Y.Z`
tag is pushed. The workflow re-runs the publish-critical gates (unit + headless
Worker/WASM + bundler smokes) and only publishes if they pass and the tag matches
`package.json`. Cut releases from `main`, which CI keeps green.

## One-time setup

- An `NPM_TOKEN` repository secret must exist (an npm **Automation** access token):
  _Settings → Secrets and variables → Actions → New repository secret_.

## Cut a release

1. Make sure `main` is green. Move the `## [Unreleased]` entries in
   [`CHANGELOG.md`](CHANGELOG.md) under a new `## [X.Y.Z]` heading with today's date,
   and update the compare-link footnotes. Commit that.
2. Bump the version and create the tag (this commits `package.json` + tags it):

   ```bash
   npm version <patch|minor|major>
   ```

3. Push the commit and tag:

   ```bash
   git push origin main --follow-tags
   ```

4. Watch **Actions → Release (publish to npm)**. It runs the gates and publishes
   with provenance. If a gate fails, nothing is published — fix and re-tag.
5. (Optional) Create a GitHub Release from the tag using the CHANGELOG section:

   ```bash
   gh release create vX.Y.Z --title vX.Y.Z --notes "<paste the CHANGELOG section>"
   ```

> Pre-1.0: minor versions may include breaking changes to the task/model/controller
> extension APIs. Bump **minor** for those, **patch** for fixes.
