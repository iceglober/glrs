# Changelog

## 0.2.0

### Minor Changes

- [#44](https://github.com/iceglober/harness-opencode/pull/44) [`950d638`](https://github.com/iceglober/harness-opencode/commit/950d6380958459c5565f4dbbd9b65524db39e4ea) Thanks [@iceglober](https://github.com/iceglober)! - **BREAKING (hook authors only):** `/fresh` no longer runs its built-in reset flow when `.glorious/hooks/fresh-reset` is present and executable. The hook now OWNS the reset strategy end-to-end (discard working tree, switch branch, run project-specific cleanup). Previously the hook was an augment that ran _after_ the built-in flow. Hooks that relied on the built-in flow running first must update to do their own `git reset --hard`, `git clean -fdx`, and `git checkout -b origin/<base>` — or users can pass `--skip-hook` on a case-by-case basis to force the built-in flow. Env-var inputs (`OLD_BRANCH`, `NEW_BRANCH`, `BASE_BRANCH`, `WORKTREE_DIR`, `WORKTREE_NAME`, `FRESH_PASSTHROUGH_ARGS`), pass-through positional args, exit-code semantics, and stdout-JSON-tail-for-enrichment convention are unchanged.

  Additional changes that ride along:

  - `/fresh` hook invocation now respects the hook's shebang (previously forced `bash <path>` even for hooks with `#!/usr/bin/env python3`, `#!/usr/bin/env zsh`, etc.). This was a latent bug; non-bash hooks now run correctly.
  - `/fresh` `--skip-hook` semantics: "bypass the hook and use the built-in reset." Functionally equivalent for users who only relied on augment-mode hooks (both skip the hook; built-in runs either way). Mental-model rename, not a behavior break for that case.
  - Non-executable `.glorious/hooks/fresh-reset` (hook file present, `+x` bit unset) now emits a WARN in the `/fresh` summary and handoff brief and falls back to the built-in flow. Previously the hook was silently skipped, surprising users who `chmod -x`'d their hook as a kill-switch but got no visible feedback.
  - `/fresh` command description rewritten to reflect actual behavior (re-keys an existing worktree, does not create one, does not require `gsag`).
  - Removed dangling reference to `docs/fresh.md` in `src/commands/prompts/fresh.md` (the doc was deleted in v0.1.0 rename but the reference in the prompt survived).

### Patch Changes

- [#41](https://github.com/iceglober/harness-opencode/pull/41) [`d53c9bb`](https://github.com/iceglober/harness-opencode/commit/d53c9bbc37eacd3ce8e397d4b6c5342077ab4b2c) Thanks [@iceglober](https://github.com/iceglober)! - Automate releases with Changesets. Every PR now declares its version impact via `bunx changeset`; merges to `main` open a "Version Packages" PR that aggregates pending changesets; merging that PR auto-publishes to npm with provenance. No runtime behavior change for end users.

All notable changes to `@glrs-dev/harness-opencode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-04-21

### Fixed

- **Plugin failed to load in production.** When tsup bundles `src/agents/shared/index.ts`, `src/agents/index.ts`, `src/commands/index.ts`, and `src/bin/plan-check.ts` into `dist/index.js`, `import.meta.url` resolves to `dist/` — not the original module's subdirectory. All `readFileSync`-based path resolution was looking for `dist/prompts/<file>` instead of `dist/agents/prompts/<file>`, causing `Could not find shared file: workflow-mechanics.md` on every session start. Agents, commands, and plan-check all failed to load; only `plan` and `build` (which come from OpenCode's built-in agents, not our plugin) were visible.
- **Migration docs used GNU-only `find -xtype l`** which fails on macOS's BSD `find`. Replaced with portable `find -type l ! -exec test -e {} \; -print -delete`.

## [0.1.1] — 2026-04-21

### Changed

- Version bump to exercise the release CI pipeline end-to-end. No functional changes from 0.1.0.

## [0.1.0] — 2026-04-21

### Added

- Initial npm release. Pivoted from the clone+symlink installer model to an npm-delivered OpenCode plugin.
- 12 agents (3 primary + 9 subagents) registered via the plugin `config` hook.
- 7 slash commands: `/ship`, `/autopilot`, `/review`, `/init-deep`, `/research`, `/fresh`, `/costs`.
- 5 custom tools: `ast_grep`, `tsc_check`, `eslint_check`, `todo_scan`, `comment_check`.
- 4 bundled skills: `review-plan`, `web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`.
- MCP server wiring for `serena`, `memory`, `git` (enabled), `playwright`, `linear` (disabled by default).
- Bundled sub-plugins: `notify` (OS notifications), `autopilot` (completion-tag loop), `cost-tracker` (LLM spend tracking).
- CLI: `bunx @glrs-dev/harness-opencode install`, `uninstall`, `doctor`, `plan-check`.

### Migration from clone+symlink install

See [MIGRATION.md](./MIGRATION.md) and [docs/migration-from-clone-install.md](./docs/migration-from-clone-install.md).
The last pre-pivot state is tagged `v0-legacy-clone-install` with the retired installer scripts attached as release assets.
