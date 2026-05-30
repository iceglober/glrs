---
"@glrs-dev/harness-plugin-opencode": patch
---

Fix self-update cache-dir path. `getOpenCodeCachePackageDir()` was looking at `~/.cache/opencode/packages/@glrs-dev/harness-opencode@latest/`, but opencode actually writes the cache at `harness-plugin-opencode@latest/` (matching the package name). The mismatch made every release return `cache-missing` and silently fall through, forcing users to manually `rm -rf` the cache after each release. The self-update hook already ran every session and did the right thing — it was just pointed at a non-existent directory.
