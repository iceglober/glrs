# @glrs-dev/cli

## 0.1.0

### Minor Changes

- [`37da38d`](https://github.com/iceglober/glrs/commit/37da38d0c0ffebf6758ef696644be3c79203eb4d) Thanks [@iceglober](https://github.com/iceglober)! - **First release of `@glrs-dev/cli` as the unified entry point for the @glrs-dev ecosystem.**

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

- [`b3ff224`](https://github.com/iceglober/glrs/commit/b3ff2249da36abb6669588ddf08d57c2d3b00464) Thanks [@iceglober](https://github.com/iceglober)! - Add `@research` agent and four bundled research skills (`research`, `research-web`, `research-local`, `research-auto`) to the vendored harness-opencode. `@research` is an Opus-class, `mode: all` orchestrator that decomposes research queries into parallel workstreams, dispatches per-workstream sub-agents using one of the four skills (multi-round umbrella, local codebase, web, or autonomous `.lab/` experimentation), reviews findings for gaps, iterates, and synthesizes. The existing `/research` slash command is rewritten as a thin delegator to `@research`; PRIME's subagent-reference recap gains an `@research` entry so its task-tool picker surfaces the agent alongside `@plan`, `@build`, `@code-searcher`, `@qa-reviewer`, etc.

## 0.0.1

### Patch Changes

- Updated dependencies [[`689c103`](https://github.com/iceglober/glrs/commit/689c1034bd2b5f5c54af40b18b3c1d3bb3db4bb4), [`054cf1a`](https://github.com/iceglober/glrs/commit/054cf1ad516c171a93a1383aacd318ca670155fa)]:
  - @glrs-dev/harness-opencode@1.0.0

## 1.0.0

### Major Changes

- Initial release. Unified CLI for the `@glrs-dev` ecosystem.
- Provides a single `glrs` binary with three subcommands:
  - `glrs oc` → `harness-opencode` (OpenCode agent harness)
  - `glrs agentic` → `gs-agentic` / `gsag` (agentic workflows)
  - `glrs assume` → `gs-assume` / `gsa` (SSO credential manager)
- Pure dispatcher — no CLI logic duplication. Each subtool retains its own direct bin for power users.
