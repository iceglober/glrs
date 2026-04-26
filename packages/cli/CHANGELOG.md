# @glrs-dev/cli

## 1.0.0

### Major Changes

- Initial release. Unified CLI for the `@glrs-dev` ecosystem.
- Provides a single `glrs` binary with three subcommands:
  - `glrs oc` → `harness-opencode` (OpenCode agent harness)
  - `glrs agentic` → `gs-agentic` / `gsag` (agentic workflows)
  - `glrs assume` → `gs-assume` / `gsa` (SSO credential manager)
- Pure dispatcher — no CLI logic duplication. Each subtool retains its own direct bin for power users.
