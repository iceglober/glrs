---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(telemetry): use production mode for published builds

`isDebug` was keyed off `NODE_ENV !== "production"`, which is never true in a user's terminal — so every event was tagged as debug and filtered from Aptabase's production dashboard. Now uses `PKG_VERSION === "dev"` instead: published npm builds (where tsup bakes in the real version) report as production; unbundled dev/test runs report as debug.
