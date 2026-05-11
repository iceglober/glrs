---
"@glrs-dev/cli": minor
---

Add auto-update to the `glrs` CLI. On every invocation (rate-limited to once per hour), checks the npm registry for a newer version. If found, installs it globally via `bun add -g` and re-execs the command so the user always runs the latest version. Disable with `GLRS_AUTO_UPDATE=0`.
