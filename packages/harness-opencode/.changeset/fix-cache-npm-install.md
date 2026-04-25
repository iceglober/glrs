---
"@glrs-dev/harness-opencode": patch
---

Fix auto-update leaving plugin cache without node_modules. The cache refresh deleted node_modules and assumed OpenCode would reinstall on next start — it doesn't. Now runs `npm install` after rewriting the pin so the new version is immediately available.
