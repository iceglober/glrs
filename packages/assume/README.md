<div align="center">

<br/>

# `@glrs-dev/assume`

**Authenticate once, work all day.**<br/>
Multi-cloud credential manager with per-shell context switching.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@glrs-dev/assume?style=flat-square)](https://www.npmjs.com/package/@glrs-dev/assume)

<br/>

</div>

## Getting Started

### Install

```bash
npm i -g @glrs-dev/assume
```

The prebuilt binary for your platform is auto-selected via npm's `optionalDependencies`. No postinstall scripts.

Two equivalent bins ship with the package: `gs-assume` and `gsa` (shorter alias). Pick one; they're identical.

> [!NOTE]
> Crates.io publishing (`cargo install glrs-assume`) is planned but not yet enabled. For now, `npm i -g @glrs-dev/assume` is the only install path.

### First-time setup

```bash
gsa login aws       # Opens browser for AWS Identity Center
gsa profiles        # List all available account/role pairs
gsa use dev         # Switch context by fuzzy match
```

<br/>

## The Daily Loop

> Login once, switch instantly, credentials follow you.

```bash
gsa login aws                    # authenticate (once per session)
gsa use dev                      # switch context in this shell
gsa use prod                     # different context in another shell
aws s3 ls                        # just works — credentials served locally
gsa console                      # open AWS console in browser
```

<br/>

## Commands

| Command | What happens |
|:--|:--|
| `gsa login <provider>` | Interactive auth — opens browser, polls for completion |
| `gsa use <pattern>` | Fuzzy-match context switch, per-shell. TUI picker if no pattern. |
| `gsa profiles` | List all contexts with active marker and danger tags |
| `gsa status` | Auth status, token expiry, active context, daemon health |
| `gsa sync` | Re-fetch contexts from provider APIs |
| `gsa exec -- <cmd>` | Run a command with injected credentials |
| `gsa console` | Open provider's web console for active context |
| `gsa credential-process` | AWS `credential_process` JSON output for SDK integration |
| `gsa config show` | View current configuration |
| `gsa config set <key> <val>` | Set a config value (dot notation) |
| `gsa shell-init <shell>` | Print shell integration script (bash, zsh, fish) |
| `gsa serve --install` | Install to PATH + launch agent (daemon starts on login) |
| `gsa serve --uninstall` | Remove binary, symlink, and launch agent |
| `gsa upgrade` | Self-update to latest release |
| `gsa logout [provider]` | Clear stored credentials |

<br/>

## Agent & MCP Integration

Permission-gated credential access for AI agents (Claude Code, etc.).

| Command | What happens |
|:--|:--|
| `gsa agent allow` | TUI multi-select to toggle which contexts agents can access |
| `gsa agent allow --list` | Show currently approved contexts |
| `gsa agent allow --clear` | Revoke all agent access |
| `gsa agent exec -- <cmd>` | Run a command with auto-refreshing credentials (permission-gated) |
| `gsa agent mcp` | Start MCP server for AI agent integration |

**Default deny** — no context is agent-accessible unless explicitly approved via `gsa agent allow`.

### MCP server

Register in your Claude Code settings:

```json
{
  "mcpServers": {
    "gsa": { "command": "gsa", "args": ["agent", "mcp"] }
  }
}
```

Tools provided:
- **`run_with_credentials`** — run a shell command with auto-refreshing AWS credentials
- **`list_contexts`** — list contexts approved for agent access

### Wrapping other MCP servers

Any MCP server that needs AWS credentials can be wrapped with `gsa agent exec`:

```json
{
  "mcpServers": {
    "aws-tools": { "command": "gsa", "args": ["agent", "exec", "--", "npx", "@aws/mcp-server"] }
  }
}
```

The wrapped server inherits `AWS_CONTAINER_CREDENTIALS_FULL_URI` pointing at the daemon, so credentials auto-refresh indefinitely.

<br/>

## Shell Integration

`serve --install` adds this to your shell rc automatically:

```bash
eval "$(gsa shell-init zsh)"
```

This gives you:
- **`gsa` wrapper** — `gsa use` sets context as an env var in the current shell
- **Prompt segment** — shows `[aws:account/role]` in green (or red for dangerous contexts)
- **Per-shell isolation** — each terminal can have a different active context
- **Zero prompt delay** — reads an env var, no subprocess

<br/>

## Configuration

Config file: `~/.config/gs-assume/config.toml` (macOS: `~/Library/Application Support/gs-assume/config.toml`)

```toml
[providers.aws]
start_url = "https://myorg.awsapps.com/start"
region = "us-east-1"

[[providers.aws.profiles]]
account_id = "111111111111"
role_name = "AdministratorAccess"
alias = "prod/admin"
tags = ["production", "dangerous"]
color = "red"
confirm = true
```

Team config (`gs-assume.team.toml` in repo root) merges with user config — user wins on conflicts.

<br/>

## Security

- Credentials encrypted at rest with **AES-256-GCM** (not plaintext like AWS CLI, granted, or Leapp)
- Encryption key stored at `vault.key` with `0600` permissions
- Credential daemon serves tokens over `localhost` only
- All token files are `0600`
- Agent access gated by `agent-allowed.json` allowlist (default deny)
- All credential operations audit-logged to `~/.config/gs-assume/audit.log`

<br/>

## Architecture

```
src/
├── main.rs                 # CLI entry (clap)
├── cli/
│   ├── agent.rs            # Agent access: allow, exec, mcp dispatch
│   ├── mcp.rs              # MCP JSON-RPC 2.0 server over stdio
│   ├── login.rs            # Interactive auth + first-time setup
│   ├── use_cmd.rs          # Fuzzy context switch, per-shell env vars
│   ├── status.rs           # Auth status + prompt segment
│   ├── profiles.rs         # Context listing with danger tags
│   ├── sync.rs             # Re-fetch contexts from APIs
│   ├── exec.rs             # Run command with injected creds
│   ├── serve.rs            # Daemon + install/uninstall
│   ├── console.rs          # Open web console
│   ├── config_cmd.rs       # Config get/set/show
│   ├── shell_init.rs       # Shell integration output
│   ├── credential_process.rs # AWS credential_process
│   ├── logout.rs           # Clear credentials
│   └── upgrade.rs          # Self-update
├── core/
│   ├── config.rs           # TOML config + team config merging
│   ├── keychain.rs         # AES-256-GCM encrypted storage
│   ├── cache.rs            # Context + active context + agent-allowed cache
│   ├── daemon.rs           # Daemon lifecycle, refresh loop, launchd
│   ├── fuzzy.rs            # nucleo fuzzy matching
│   ├── rpc.rs              # Unix socket RPC
│   ├── audit.rs            # Event logging
│   ├── notify.rs           # Desktop notifications
│   └── update_check.rs     # Version check + auto-upgrade
├── plugin/
│   ├── mod.rs              # Provider trait + data types
│   └── registry.rs         # Plugin registry + validation
├── providers/
│   ├── aws/                # AWS Identity Center (SSO OIDC + STS)
│   └── gcp/                # Google Cloud (stub)
├── tui/
│   └── picker.rs           # Interactive context picker + multi-select
└── shell/
    ├── prompt.rs           # ANSI prompt formatting
    └── completions.rs      # Shell completions
```

---

<div align="center">
<sub>MIT License</sub>
</div>
