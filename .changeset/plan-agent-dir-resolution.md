---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): resolve plan directory at config time instead of via bash snippet

The plan agent's bash permissions blocked compound commands, preventing it from
running the inline plan-dir resolution snippet. The plan directory is now resolved
synchronously at plugin config time and injected into the plan and scoper prompts
as a pre-resolved path. The plan agent's bash permission is simplified to a flat
deny since it no longer needs bash for plan-dir resolution.
