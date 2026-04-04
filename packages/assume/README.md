<div align="center">

<br/>

# `assume`

**Authenticate once, work all day.**<br/>
Multi-cloud credential manager with per-shell context switching.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/iceglober/glorious?filter=assume-*&style=flat-square&label=latest)](https://github.com/iceglober/glorious/releases)

<br/>

</div>

## Getting Started

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/assume/install.sh | bash
```

No dependencies required beyond `curl` and `python3`. This downloads the pre-built binary, installs to `~/.local/bin`, adds shell integration, and starts the daemon.

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

## Shell Integration

`serve --install` adds this to your shell rc automatically:

```bash
eval "$(gs-assume shell-init zsh)"
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

<br/>

## Architecture

```
src/
├── main.rs                 # CLI entry (clap)
├── cli/
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
│   ├── cache.rs            # Context + active context file cache
│   ├── daemon.rs           # Daemon lifecycle, refresh loop, launchd
│   ├── fuzzy.rs            # nucleo fuzzy matching
│   ├── rpc.rs              # Unix socket RPC
│   ├── audit.rs            # Event logging
│   ├── notify.rs           # Desktop notifications
│   └── update_check.rs     # Version check + self-update
├── plugin/
│   ├── mod.rs              # Provider trait + data types
│   └── registry.rs         # Plugin registry + validation
├── providers/
│   ├── aws/                # AWS Identity Center (SSO OIDC + STS)
│   └── gcp/                # Google Cloud (stub — coming soon)
├── tui/
│   └── picker.rs           # Interactive context picker
└── shell/
    ├── prompt.rs           # ANSI prompt formatting
    └── completions.rs      # Shell completions
```

---

<div align="center">
<sub>MIT License</sub>
</div>
