---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): plugin failed to load in opencode ("Cannot find module '@opencode-ai/plugin'")

The published plugin's `dist/index.js` did runtime imports of `@opencode-ai/plugin`
(the `tool` helper used by the custom tools) and `zod`, both left external. opencode
installs each plugin into its own cache, but a `@glrs-dev/agent-core: "workspace:*"`
spec leaking into the published `devDependencies` made that install abort
(`EUNSUPPORTEDPROTOCOL workspace:`), so no deps — including `zod` — were present at
load time. The whole harness then failed to load: no agents, commands, or MCPs.

Fix: bundle `@opencode-ai/plugin` and `zod` into the plugin entry (tsup `noExternal`),
so `dist/index.js` has zero third-party runtime dependencies and loads even when
opencode's cache dep-install fails. (`@opencode-ai/sdk` stays external — every import
of it is type-only and erased at build.)

This makes the published plugin self-contained and robust to the dep-install failure;
the `workspace:*` leak is now harmless to loading. (Removing the leak itself requires a
publish-time manifest fix — `agent-core` is a build-time-only workspace dep — tracked
separately so it doesn't risk this hotfix.)
