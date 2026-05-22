---
"@glrs-dev/autopilot": patch
"@glrs-dev/cli": patch
---

Fix phase cost summaries showing $0.00 by returning cumulativeCostUsd from all runRalphLoop exit paths. Route `glrs autopilot` through cmd-ts so --plan, --fast, and other flags are parsed.
