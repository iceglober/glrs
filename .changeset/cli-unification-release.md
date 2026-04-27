---
"@glrs-dev/cli": minor
---

**First release of `@glrs-dev/cli` as the unified entry point for the @glrs-dev ecosystem.**

## What's included

- `glrs oc <args>` — dispatches to a vendored copy of `@glrs-dev/harness-opencode` (the OpenCode agent harness). The harness-opencode bin is bundled inside this tarball at `dist/vendor/harness-opencode/`; no separate install needed.
- `glrs wt <args>` — worktree management (create, list, switch, delete, cleanup). Stores worktrees under `~/.glorious/worktrees/<repo>/<name>/`.

## Install

```bash
npm i -g @glrs-dev/cli
```

Requires Bun >= 1.2.0 on PATH — the CLI and the vendored harness use Bun-native APIs (`bun:sqlite`, `Bun.spawn`).

## Migration

- `@glrs-dev/harness-opencode` on npm is being deprecated. Its final published version (`0.16.2` or later) should be the last. Users should migrate to `glrs oc <args>`.
- `@glrs-dev/agentic` has been removed from the repo. Its worktree-management commands live natively under `glrs wt`.
- `@glrs-dev/assume` remains a separate, standalone package — install it independently if you need the SSO credential manager.
