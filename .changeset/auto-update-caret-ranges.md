---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(auto-update): handle caret/tilde ranges in plugin cache

The auto-updater skipped caret (`^2.10.10`) and tilde (`~2.10.10`) ranges as "user-managed", but OpenCode's default cache uses `^` ranges. The lockfile pins the resolved version, so updates never landed — users stayed on the version from their first install indefinitely. Now treats `^`/`~` ranges the same as exact pins: extracts the base version, compares, and triggers a refresh when a newer version is available. Also deletes all lockfile formats (npm, bun) instead of rewriting just `package-lock.json`.
