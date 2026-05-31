---
title: Install
description: One install command for the whole ecosystem.
---

## The CLI

```bash
npm i -g @glrs-dev/cli
```

This installs the unified `glrs` dispatcher with:
- `glrs harness <args>` — OpenCode agent harness management
- `glrs wt <args>` — worktree management
- `glrs autopilot` — autonomous scope → plan → execute orchestrator
- `glrs loop` — raw prompt loop runner
- `glrs dashboard` — live TUI for autopilot sessions
- `glrs upgrade` — self-update

Verify:

```bash
glrs --help
glrs harness --help
glrs wt --help
```

## The SSO credential manager (optional, separate)

`@glrs-dev/assume` is a standalone Rust binary distributed on npm. Install it separately:

```bash
npm i -g @glrs-dev/assume
```

Or via Cargo (planned, not yet enabled):

```bash
cargo install glrs-assume  # coming soon
```

## Requirements

- **Bun ≥ 1.2.0** on PATH — the CLI uses Bun-native APIs. Install from [bun.sh](https://bun.sh).
- **macOS, Linux, or Windows** on x64 or arm64 for `@glrs-dev/assume` (prebuilt binary platforms)
- **GitHub CLI** (`gh`) for any GitHub-interacting commands
