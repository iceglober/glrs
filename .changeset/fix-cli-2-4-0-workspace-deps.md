---
"@glrs-dev/cli": patch
"@glrs-dev/harness-plugin-opencode": patch
---

Fix `@glrs-dev/cli@2.4.0` install failure caused by `workspace:*` references to private packages leaking into the published tarball. The cli now vendors `@glrs-dev/autopilot` and `@glrs-dev/adapter-opencode` into its `dist/node_modules/` and strips workspace references from the published `package.json`.
