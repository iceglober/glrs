# @glrs-dev/cli

## 2.10.12

### Patch Changes

- [#122](https://github.com/iceglober/glrs/pull/122) [`088dcd8`](https://github.com/iceglober/glrs/commit/088dcd8a2cbf40e2e83271d1f8dc794fceeee2b5) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot recovery: 5 evolving retry attempts on every failure mode (verify, crash, stall, max-iterations) with progressive strategy changes and deep-model escalation. Phases never skip on failure — the run halts if all attempts exhaust.

  CLI: fix preflight validation blocking unenriched plans (single-file and directory without spec/) from reaching the enrichment step.

- Updated dependencies [[`088dcd8`](https://github.com/iceglober/glrs/commit/088dcd8a2cbf40e2e83271d1f8dc794fceeee2b5)]:
  - @glrs-dev/autopilot@0.4.0
  - @glrs-dev/adapter-claude-code@0.1.9
  - @glrs-dev/adapter-opencode@0.1.9
  - @glrs-dev/harness-plugin-opencode@2.10.12

## 2.10.11

### Patch Changes

- Updated dependencies [[`d1ce47e`](https://github.com/iceglober/glrs/commit/d1ce47e8e1846587dfe0bc7fef2cf5e486464f38)]:
  - @glrs-dev/autopilot@0.3.0
  - @glrs-dev/adapter-claude-code@0.1.8
  - @glrs-dev/adapter-opencode@0.1.8
  - @glrs-dev/harness-plugin-opencode@2.10.11

## 2.10.10

### Patch Changes

- Updated dependencies [[`6eeda55`](https://github.com/iceglober/glrs/commit/6eeda55873110c7732eacb611b43df08c03e6350)]:
  - @glrs-dev/harness-plugin-opencode@2.10.10

## 2.10.9

### Patch Changes

- Updated dependencies [[`d987e11`](https://github.com/iceglober/glrs/commit/d987e1197e8ee62cbd40dad8e9f4f3cfc5944c07)]:
  - @glrs-dev/harness-plugin-opencode@2.10.9
  - @glrs-dev/autopilot@0.2.5
  - @glrs-dev/adapter-claude-code@0.1.7
  - @glrs-dev/adapter-opencode@0.1.7

## 2.10.8

### Patch Changes

- [#111](https://github.com/iceglober/glrs/pull/111) [`d2c6b97`](https://github.com/iceglober/glrs/commit/d2c6b9781e5b77c42a336dad8103b7a059d3e898) Thanks [@iceglober](https://github.com/iceglober)! - Fix autopilot plan picker ignoring `.glrs` directory and add `--target` as alias for `--adapter`.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.10.8

## 2.10.7

### Patch Changes

- Updated dependencies [[`39a16fb`](https://github.com/iceglober/glrs/commit/39a16fb66ffd817ef82436106d8d6fa1b78bc0e9)]:
  - @glrs-dev/harness-plugin-opencode@2.10.7

## 2.10.6

### Patch Changes

- Updated dependencies [[`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1), [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1), [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1)]:
  - @glrs-dev/autopilot@0.2.4
  - @glrs-dev/adapter-claude-code@0.1.6
  - @glrs-dev/adapter-opencode@0.1.6
  - @glrs-dev/harness-plugin-opencode@2.10.6

## 2.10.5

### Patch Changes

- Updated dependencies [[`82b1221`](https://github.com/iceglober/glrs/commit/82b122100ecb67edd01fcc169f43fcaab55f4108), [`82b1221`](https://github.com/iceglober/glrs/commit/82b122100ecb67edd01fcc169f43fcaab55f4108)]:
  - @glrs-dev/autopilot@0.2.3
  - @glrs-dev/adapter-claude-code@0.1.5
  - @glrs-dev/adapter-opencode@0.1.5
  - @glrs-dev/harness-plugin-opencode@2.10.5

## 2.10.4

### Patch Changes

- Updated dependencies [[`05c5fa7`](https://github.com/iceglober/glrs/commit/05c5fa76322634bfa1ec08594d7dff0127404c45)]:
  - @glrs-dev/autopilot@0.2.2
  - @glrs-dev/adapter-claude-code@0.1.4
  - @glrs-dev/adapter-opencode@0.1.4
  - @glrs-dev/harness-plugin-opencode@2.10.4

## 2.10.3

### Patch Changes

- Updated dependencies [[`6d307dc`](https://github.com/iceglober/glrs/commit/6d307dc93011603d1b031ac757ed3d6e94ebffa4)]:
  - @glrs-dev/autopilot@0.2.1
  - @glrs-dev/adapter-claude-code@0.1.3
  - @glrs-dev/adapter-opencode@0.1.3
  - @glrs-dev/harness-plugin-opencode@2.10.3

## 2.10.2

### Patch Changes

- Updated dependencies [[`a230910`](https://github.com/iceglober/glrs/commit/a23091090be18f567a924bdd8ccbaa81f9942e64)]:
  - @glrs-dev/harness-plugin-opencode@2.10.2

## 2.10.1

### Patch Changes

- [#95](https://github.com/iceglober/glrs/pull/95) [`d171c97`](https://github.com/iceglober/glrs/commit/d171c97d6126bd415e994e2cb629ca2735be6d8b) Thanks [@iceglober](https://github.com/iceglober)! - Fix two autopilot bugs that surfaced as "Phase file referenced in spec/main.yaml does not exist": pre-flight validation now auto-recovers from stale `spec/` directories, and orphaned phase references in `main.md` are auto-decomposed before enrichment (with a precise actionable error on decomposition failure).

- Updated dependencies [[`07b0f45`](https://github.com/iceglober/glrs/commit/07b0f4574dfd87209d4375bcf4ec2a97c46c8749)]:
  - @glrs-dev/harness-plugin-opencode@2.10.1

## 2.10.0

### Minor Changes

- [#93](https://github.com/iceglober/glrs/pull/93) [`8213a53`](https://github.com/iceglober/glrs/commit/8213a531bee0a4cd11ce46fe373e5ecdd485bce6) Thanks [@iceglober](https://github.com/iceglober)! - Add live stderr output to `glrs loop` so users get at-least-once-per-minute feedback (iteration progress, tool calls, cost, thinking indicators) instead of silence until the loop exits.

### Patch Changes

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.10.0

## 2.9.2

### Patch Changes

- [#90](https://github.com/iceglober/glrs/pull/90) [`8c5b629`](https://github.com/iceglober/glrs/commit/8c5b629ceb9155421fb2ecb7c25a98b3d503d034) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot now auto-recovers when a prior crashed run left an inconsistent `spec/` directory (stale spec — no more "phase file referenced in spec/main.yaml does not exist" deadlock). When the loop fails, the CLI now prints the actual error Reason and exits with a non-zero exit code so CI and shell scripts can detect failure.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.9.2

## 2.9.1

### Patch Changes

- [#87](https://github.com/iceglober/glrs/pull/87) [`bf6bfe4`](https://github.com/iceglober/glrs/commit/bf6bfe49b631fa86711d7d6259c6826d574406c4) Thanks [@iceglober](https://github.com/iceglober)! - Fix `glrs autopilot --plan …` failing with `Unknown enrichment strategy "default"` on clean installs. The autopilot package's tsup build now correctly bundles `strategies/default.md` and `prompt-template.md` into `dist/`, so the vendored CLI artifact ships with the runtime markdown assets it needs.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.9.1

## 2.9.0

### Minor Changes

- [#85](https://github.com/iceglober/glrs/pull/85) [`e008596`](https://github.com/iceglober/glrs/commit/e008596aba81fa0942c9299f74c35be922e85a80) Thanks [@iceglober](https://github.com/iceglober)! - Add `glrs upgrade` command (bypasses bun's stale cache). PRIME now dispatches parallel @build subagents for multi-phase plans with disjoint file sets.

### Patch Changes

- Updated dependencies [[`e008596`](https://github.com/iceglober/glrs/commit/e008596aba81fa0942c9299f74c35be922e85a80)]:
  - @glrs-dev/harness-plugin-opencode@2.9.0

## 2.8.0

### Minor Changes

- [#83](https://github.com/iceglober/glrs/pull/83) [`407e0a5`](https://github.com/iceglober/glrs/commit/407e0a5b20c96474c556a88e45ae9e0dcde8cc36) Thanks [@iceglober](https://github.com/iceglober)! - Remove `--fast` flag. Enrichment now runs unconditionally (idempotent skip when specs already enriched). Per-item execution is the sole strategy with 25-iteration budget and 5-min stall timeout.

### Patch Changes

- Updated dependencies [[`407e0a5`](https://github.com/iceglober/glrs/commit/407e0a5b20c96474c556a88e45ae9e0dcde8cc36)]:
  - @glrs-dev/autopilot@0.2.0
  - @glrs-dev/adapter-claude-code@0.1.2
  - @glrs-dev/adapter-opencode@0.1.2
  - @glrs-dev/harness-plugin-opencode@2.8.0

## 2.7.0

### Minor Changes

- [#81](https://github.com/iceglober/glrs/pull/81) [`b0d02dc`](https://github.com/iceglober/glrs/commit/b0d02dcb3ab8636445c4d0317ccd61dc9581bdff) Thanks [@iceglober](https://github.com/iceglober)! - Simplify CLI deployment model and fix runtime module resolution.

  **Breaking (harness-plugin-opencode):**

  - Remove `bin` field — the package no longer ships standalone `glrs-oc` / `harness-opencode` binaries. Users should install `@glrs-dev/cli` and use `glrs harness install|configure|doctor|uninstall`.
  - Add `./cli` subpath export for CLI handler functions consumed by `@glrs-dev/cli`.

  **CLI:**

  - Add `glrs harness` subcommand (install, configure, uninstall, doctor) — replaces the old `glrs oc` subprocess dispatch.
  - Deprecate `glrs oc` with a redirect notice pointing to `glrs harness`.
  - Fix deep import (`@glrs-dev/autopilot/src/model-resolver.js`) that crashed `glrs loop` when installed from npm.
  - Vendor harness-plugin-opencode into `dist/node_modules/` (same as autopilot/adapter) instead of the old `dist/vendor/` subprocess path.

  **CI:**

  - Skip Rust (gs-assume) build/test/clippy/fmt unless `packages/assume/**` files are touched.

### Patch Changes

- Updated dependencies [[`b0d02dc`](https://github.com/iceglober/glrs/commit/b0d02dcb3ab8636445c4d0317ccd61dc9581bdff)]:
  - @glrs-dev/harness-plugin-opencode@2.7.0

## 2.6.0

### Minor Changes

- [#79](https://github.com/iceglober/glrs/pull/79) [`3d19166`](https://github.com/iceglober/glrs/commit/3d1916633ff6796238f08616c88038fd5b734174) Thanks [@iceglober](https://github.com/iceglober)! - Refactor harness subagent prompts for consistency and register `glrs loop` CLI subcommand.

  **Harness prompt refactor:**

  - Remove inline SPEAR protocol from prime.md (41% reduction); spear-protocol skill is now the sole canonical source
  - Consolidate three identical reviewer permission blocks into one shared `REVIEWER_PERMISSIONS` constant
  - Remove UI evaluation ladder from plan-reviewer and gap-analyzer (neither verifies web UI)
  - Remove repo-specific assumptions from docs-maintainer prompt
  - Fix broken bash snippet reference in scoper.md (was a placeholder, now the actual snippet)
  - Fix circular self-reference in plan.md defensive posture section
  - Standardize question-tool phrasing across all utility agents
  - Clean up research.md self-reference and redundant invocation docs
  - Update test assertions to match refactored content

  **CLI:**

  - Register `glrs loop` as a top-level subcommand (was defined but never routed)
  - Add `glrs autopilot` and `glrs loop` to help text

## 2.5.0

### Patch Changes

- [#77](https://github.com/iceglober/glrs/pull/77) [`d684392`](https://github.com/iceglober/glrs/commit/d68439287a0a4bd9496011232e3e81d72bbda398) Thanks [@iceglober](https://github.com/iceglober)! - Fix phase cost summaries showing $0.00 by returning cumulativeCostUsd from all runRalphLoop exit paths. Route `glrs autopilot` through cmd-ts so --plan, --fast, and other flags are parsed.

- Updated dependencies [[`d684392`](https://github.com/iceglober/glrs/commit/d68439287a0a4bd9496011232e3e81d72bbda398)]:
  - @glrs-dev/autopilot@0.1.1
  - @glrs-dev/adapter-claude-code@0.1.1
  - @glrs-dev/adapter-opencode@0.1.1

## 2.4.1

### Patch Changes

- [#75](https://github.com/iceglober/glrs/pull/75) [`9532a63`](https://github.com/iceglober/glrs/commit/9532a63157cc0edad7822452e710848052dde9fa) Thanks [@iceglober](https://github.com/iceglober)! - Fix `@glrs-dev/cli@2.4.0` install failure caused by `workspace:*` references to private packages leaking into the published tarball. The cli now vendors `@glrs-dev/autopilot` and `@glrs-dev/adapter-opencode` into its `dist/node_modules/` and strips workspace references from the published `package.json`.

## 2.4.0

## 2.3.0

## 2.2.0

## 2.1.0

### Minor Changes

- [#51](https://github.com/iceglober/glrs/pull/51) [`c3c6be8`](https://github.com/iceglober/glrs/commit/c3c6be8fb21052275f0ff4c60ba1ed3d93d5532f) Thanks [@iceglober](https://github.com/iceglober)! - Add auto-update to the `glrs` CLI. On every invocation (rate-limited to once per hour), checks the npm registry for a newer version. If found, installs it globally via `bun add -g` and re-execs the command so the user always runs the latest version. Disable with `GLRS_AUTO_UPDATE=0`.

## 2.0.1

## 2.0.0

## 1.2.0

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
