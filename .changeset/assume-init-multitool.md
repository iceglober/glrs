---
"@glrs-dev/assume": minor
---

`gsa init`: prompt to select which agent tools to configure, and fix the MCP writers

- `gsa init` now shows a multi-select of supported agent tools (OpenCode, Claude Code, Gemini CLI, Cursor) instead of silently auto-detecting one. Installed tools are pre-checked; you choose which to wire the `gsa` MCP server into.
- Fix OpenCode MCP entry: it now writes the correct `mcp` schema (`{ "type": "local", "command": ["gsa", "agent", "mcp"], "enabled": true }`) instead of the stdio `command`/`args` shape OpenCode ignores.
- Fix Claude Code target: MCP servers are written to `~/.claude.json` (`mcpServers`), not `~/.claude/settings.json`.
- Add Gemini CLI (`~/.gemini/settings.json`) and Cursor (`~/.cursor/mcp.json`) support, creating the config file when absent and preserving existing keys.
