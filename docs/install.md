---
title: Install
description: One install command for the whole ecosystem.
---

## The CLI

```bash
npm i -g @glrs-dev/cli
```

This installs the unified `glrs` dispatcher with:
- `glrs harness` — OpenCode agent harness management
- `glrs assume` — cloud credential management (installs assume on first use)
- `glrs wt` — worktree management
- `glrs autopilot` — autonomous scope → plan → execute orchestrator
- `glrs loop` — raw prompt loop runner
- `glrs upgrade` — self-update

Verify:

```bash
glrs --help
```

## Cloud credentials (optional)

```bash
glrs assume init
```

Installs the latest `@glrs-dev/assume` (clearing the deprecated `@glorious/assume`), migrates any legacy `gs-assume` config forward, runs login, approves agent contexts, requires a default context, and configures MCP. Re-run any time to repair a broken install.

## Requirements

- **Bun ≥ 1.2.0** on PATH — install from [bun.sh](https://bun.sh)
- **macOS or Linux** on x64 or arm64
- **GitHub CLI** (`gh`) for GitHub-interacting commands
