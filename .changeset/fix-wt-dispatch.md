---
"@glrs-dev/cli": patch
---

Fix `glrs wt` subcommand dispatch (was printing help instead of executing) and replace Bun APIs unavailable in released versions with Node.js fs equivalents.
