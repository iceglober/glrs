---
"@glrs-dev/harness-plugin-opencode": patch
---

Fix pilot v2 safety gate rejecting on `.opencode/` files modified by OpenCode's background plugin upgrades. Restores the tolerance logic from v1 that ignores framework-owned paths (`.opencode/**`, `**/next-env.d.ts`, `**/*.tsbuildinfo`, `**/__snapshots__/**`, `**/*.snap`).
