---
"@glrs-dev/cli": minor
"@glrs-dev/harness-plugin-opencode": minor
---

Simplify CLI deployment model and fix runtime module resolution.

**Breaking (harness-plugin-opencode):**
- Remove `bin` field — the package no longer ships standalone `glrs-oc` / `harness-opencode` binaries. Users should install `@glrs-dev/cli` and use `glrs harness install|configure|doctor|uninstall`.
- Add `./cli` subpath export for CLI handler functions consumed by `@glrs-dev/cli`.

**CLI:**
- Add `glrs harness` subcommand (install, configure, uninstall, doctor) — replaces the old `glrs oc` subprocess dispatch.
- Deprecate `glrs oc` with a redirect notice pointing to `glrs harness`.
- Fix deep import (`@glrs-dev/autopilot/src/model-resolver.js`) that crashed `glrs loop` when installed from npm.
- Vendor harness-plugin-opencode into `dist/node_modules/` (same as autopilot/adapter) instead of the old `dist/vendor/` subprocess path.

**CI:**
- Skip Rust (gs-assume) build/test/clippy/fmt unless `packages/assume/**` files are touched.
