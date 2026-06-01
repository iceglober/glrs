---
"@glrs-dev/assume": patch
---

fix(assume): write the opencode MCP config to the path opencode actually reads

`gsa init` resolved OpenCode's config via `dirs::config_dir()`, which on macOS is
`~/Library/Application Support` — so it wrote the gsa MCP entry to
`~/Library/Application Support/opencode/opencode.json`, a file OpenCode never
reads. The "OpenCode: gsa MCP configured" message was a false read of that wrong
path, and the credential MCP never actually loaded.

OpenCode reads `$XDG_CONFIG_HOME/opencode/opencode.json` (default
`~/.config/opencode/opencode.json`) on every platform, matching the harness
installer. `gsa init` now resolves the same path. Other tools (claude-code,
gemini, cursor) were already correct (home-relative).
