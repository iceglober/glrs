# Install

## The CLI

```bash
npm i -g @glrs-dev/cli
```

This installs the unified `glrs` binary. Then register the harness plugin:

```bash
glrs harness install
```

Launch OpenCode — agents, commands, tools, and skills load automatically:

```bash
opencode
```

## Subcommands

| Command | What it does |
|---------|-------------|
| `glrs harness` | Plugin management (install, configure, uninstall, doctor) |
| `glrs wt` | Worktree management (create, list, switch, delete, cleanup) |
| `glrs autopilot` | Autonomous scope → plan → execute orchestrator |
| `glrs loop` | Raw prompt loop runner |
| `glrs upgrade` | Self-update to latest version |

## Assume (optional, separate)

`@glrs-dev/assume` is a standalone Rust binary for AWS/GCP SSO. Install it separately:

```bash
npm i -g @glrs-dev/assume
gsa login aws
```

## Requirements

- **Bun ≥ 1.2.0** on PATH — install from [bun.sh](https://bun.sh)
- **macOS or Linux** on x64 or arm64
- **GitHub CLI** (`gh`) for GitHub-interacting commands
