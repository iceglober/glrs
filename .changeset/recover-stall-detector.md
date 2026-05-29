---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): recover stall-detector plugin dropped from PR #186 squash merge

The stall-detector plugin was added in PR #186 but the squash merge captured only the first commit of the branch, dropping the plugin file. This PR restores it: a watchdog timer that fires after each assistant message finalization and nudges the session via `client.session.promptAsync()` if no tool call arrives within 45 seconds. Based on Wink (2026) — 94% recovery rate for stalled agents using asynchronous message injection.
