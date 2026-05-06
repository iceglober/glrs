---
"@glrs-dev/harness-plugin-opencode": patch
---

Fix `pilot scope` TUI spawn — remove invalid `--directory` flag and positional project path that caused opencode to print help text and exit with code 1. Goal argument is now optional (prompts interactively if not provided).
