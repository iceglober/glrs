---
"@glrs-dev/cli": patch
---

Fix `glrs harness configure` crashing on install with `Cannot find module '@clack/prompts'`.

3.17.0 rebuilt the configure TUI on @clack/prompts, but the vendored harness plugin's externals resolve against the CLI's own dependencies — and the new dep was never declared there. The workspace build kept working (hoisted node_modules), so the break only surfaced for npm installs.

Declared `@clack/prompts` in the CLI's dependencies, and added two guards so the next vendored external can't slip through: a `vendored-externals` test that scans every bare import in the built dist (CLI bundles + vendored packages) and asserts each resolves against the CLI's declared dependencies, and a pack-install smoke step that runs `glrs harness configure` from the packed tarball — the only path that loads the vendored `cli-exports.js`, which `--version` and `autopilot --help` never exercised.
