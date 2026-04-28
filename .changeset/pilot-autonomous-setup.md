---
"@glrs-dev/harness-plugin-opencode": patch
---

pilot: add top-level `setup:` for environment bootstrap + relax builder rule 4 to let environmental fumbles self-heal during the fix-loop

- **Harness-level**: Added `setup:` field to `pilot.yaml` schema. Commands run once per fresh worktree slot before any task uses that slot. Cached across tasks; re-run on slot retirement after `preserveOnFailure`. Setup failure hard-aborts the run with all pending tasks marked `blocked`.

- **Agent-level**: Rewrote pilot-builder rule 4 to distinguish task-level dependency additions (still require task prompt approval) from environment bootstrap (expected during fix-loop when verify fails with obvious environmental errors like missing `node_modules`). Recognises canonical install commands: `pnpm install`, `bun install`, `npm install`, `npm ci`, `cargo fetch` / `cargo build`.

- **Defence-in-depth**: Added tests ensuring the plugin bash-deny list continues to permit standard install commands.
