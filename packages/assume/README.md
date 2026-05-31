# @glrs-dev/assume

SSO credential manager for AWS and GCP. Rust binary, distributed via npm.

Docs: **[glrs.dev/assume](https://glrs.dev/assume)**

## Install

```bash
npm i -g @glrs-dev/assume
```

Bins: `glrs-assume`, `gsa` (alias).

## Usage

```bash
gsa login aws                # authenticate (opens browser)
gsa use dev                  # switch context (fuzzy match)
gsa use prod                 # different context per shell
aws s3 ls                    # credentials served locally
gsa console                  # open web console
gsa status                   # token expiry, daemon health
```

## Commands

| Command | What it does |
|---|---|
| `gsa login <provider>` | Browser auth, poll for completion |
| `gsa use <pattern>` | Fuzzy context switch, per-shell |
| `gsa profiles` | List contexts with danger tags |
| `gsa status` | Auth + daemon health |
| `gsa sync` | Re-fetch contexts from APIs |
| `gsa exec -- <cmd>` | Run with injected credentials |
| `gsa console` | Open web console |
| `gsa agent allow` | Toggle agent-accessible contexts |
| `gsa agent mcp` | Start MCP server for AI agents |
| `gsa upgrade` | Self-update |

## Agent integration

Default deny. Approve contexts explicitly:

```bash
gsa agent allow              # TUI multi-select
```

MCP server for Claude Code / OpenCode:

```json
{
  "mcpServers": {
    "gsa": { "command": "gsa", "args": ["agent", "mcp"] }
  }
}
```

## Shell integration

Added automatically by `gsa serve --install`:

```bash
eval "$(glrs-assume shell-init zsh)"
```

Per-shell context isolation, prompt segment, zero subprocess delay.

## Configuration

Config: `~/Library/Application Support/glrs-assume/config.toml` (macOS) or `~/.config/glrs-assume/config.toml` (Linux)

```toml
[providers.aws]
start_url = "https://myorg.awsapps.com/start"
region = "us-east-1"
```

Team config: `glrs-assume.team.toml` in repo root. User wins on conflicts.

## Security

- AES-256-GCM encrypted credential storage
- Daemon serves over localhost only
- All token files `0600`
- Agent access gated by allowlist (default deny)
- Operations audit-logged

## License

MIT
