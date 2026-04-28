---
"@glrs-dev/cli": patch
"@glrs-dev/harness-plugin-opencode": patch
---

Link `@glrs-dev/cli` and `@glrs-dev/harness-plugin-opencode` versions in Changesets config so they always release together. The CLI vendors the harness plugin's `dist/` at build time (via `packages/cli/scripts/vendor-harness.ts`), so plugin fixes don't reach users running `glrs oc install` until a CLI release is cut. Linking the two ensures every harness-plugin bump produces a matching CLI bump, closing the gap where a plugin fix sat on npm without a CLI tarball that bundled it.

This bump also forces a CLI republish that vendors `@glrs-dev/harness-plugin-opencode@0.3.0` so users get the recent `glrs oc install` reconfigure fix via `glrs oc install`, not just `glrs-oc install` directly.
