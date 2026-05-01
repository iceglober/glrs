# @glrs-dev/cli

## 1.1.0

### Patch Changes

- [#38](https://github.com/iceglober/glrs/pull/38) [`cedbc0a`](https://github.com/iceglober/glrs/commit/cedbc0a6d98fb5b91c78ec6168322593c4c98b20) Thanks [@iceglober](https://github.com/iceglober)! - Fix `glrs wt` subcommand dispatch (was printing help instead of executing) and replace Bun APIs unavailable in released versions with Node.js fs equivalents.

## 1.0.1

### Patch Changes

- [#33](https://github.com/iceglober/glrs/pull/33) [`b3a79cc`](https://github.com/iceglober/glrs/commit/b3a79cc0a9ad2f6247c4d889ee9a08a3cf0f8b41) Thanks [@iceglober](https://github.com/iceglober)! - Rewrite `packages/cli/README.md` as the single source of truth for CLI documentation. Document the bare-`glrs wt` interactive picker behavior (previously undocumented). Content for `glrs.dev/cli/` is now generated from this README via the docs-site custom content loader; there is no longer a separate site overview page to drift from.

## 1.0.0

### Patch Changes

- [#27](https://github.com/iceglober/glrs/pull/27) [`cf74f2d`](https://github.com/iceglober/glrs/commit/cf74f2dca60ee099a92a500d90de1c1886b6aed0) Thanks [@iceglober](https://github.com/iceglober)! - chore(changesets): move @glrs-dev/cli and @glrs-dev/harness-plugin-opencode from `linked` to `fixed`

  The `linked` group synchronizes versions only among packages that are ALREADY being bumped — it does not force a package into a release. A changeset that named only the harness (as most of our changesets do) would ship a new harness on npm without republishing the CLI, even though the CLI vendors the harness `dist/` at build time (`packages/cli/scripts/vendor-harness.ts`). End users running `glrs oc ...` would keep getting the old vendored harness until somebody remembered to write a no-op CLI changeset.

  Moving the pair to `fixed` guarantees any harness publish drags the CLI along at a matching version, so a fresh CLI tarball always re-vendors the latest harness `dist/`. The trade-off — CLI-only changesets now also force a no-op harness republish — is cheap because CLI-only changes are rare in this repo.

## 0.3.1

### Patch Changes

- [#19](https://github.com/iceglober/glrs/pull/19) [`6e942c5`](https://github.com/iceglober/glrs/commit/6e942c5099a535a7d1cda161a1bbc1692f937008) Thanks [@iceglober](https://github.com/iceglober)! - Link `@glrs-dev/cli` and `@glrs-dev/harness-plugin-opencode` versions in Changesets config so they always release together. The CLI vendors the harness plugin's `dist/` at build time (via `packages/cli/scripts/vendor-harness.ts`), so plugin fixes don't reach users running `glrs oc install` until a CLI release is cut. Linking the two ensures every harness-plugin bump produces a matching CLI bump, closing the gap where a plugin fix sat on npm without a CLI tarball that bundled it.

  This bump also forces a CLI republish that vendors `@glrs-dev/harness-plugin-opencode@0.3.0` so users get the recent `glrs oc install` reconfigure fix via `glrs oc install`, not just `glrs-oc install` directly.

## 0.1.1

### Patch Changes

- [`050f4b9`](https://github.com/iceglober/glrs/commit/050f4b9bf2304dd5fb5031c38e7fe247b68ead07) Thanks [@iceglober](https://github.com/iceglober)! - **Rename `@glrs-dev/harness-opencode` → `@glrs-dev/harness-plugin-opencode` and republish.**

  ## Why

  OpenCode resolves plugins by npm-installing them into `~/.cache/opencode/packages/<plugin>@<version>/` at plugin-load time. The previous plan — marking `@glrs-dev/harness-opencode` as `private: true` and vendoring it only into `@glrs-dev/cli` — broke OpenCode's plugin loader because the package wasn't published on npm, causing `ETARGET: No matching version found for @glrs-dev/harness-opencode@1.0.0`.

  The fix: publish the plugin under a new name (`@glrs-dev/harness-plugin-opencode`) so OpenCode can resolve it normally. The old name stays deprecated at its last published version (`0.16.2`).

  ## What changed

  - `packages/harness-opencode/package.json`: renamed from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`, `private: true` removed, `publishConfig.access: public` + `provenance: true` added, version reset to `0.1.0` (fresh name on npm).
  - The `install` / `uninstall` / `doctor` flows now write the new name to `opencode.json`'s plugin array.
  - `@glrs-dev/cli` still bundles a vendored copy of the plugin for standalone subprocess dispatch (`glrs oc`), but the npm-resolved copy is what OpenCode's plugin runtime loads.
  - Bin names unchanged — `harness-opencode` and `glrs-oc` still work.

  ## Migration for existing users

  Re-run `glrs oc install` to update your `opencode.json` plugin array from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`. The old entry will be replaced; no data loss.

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
