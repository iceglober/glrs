# Contributing to glrs

Thanks for contributing. This monorepo uses **pnpm workspaces**, **turborepo**, and **Changesets**. The contributor flow is:

1. Fork + branch off `main`
2. Make your change in the relevant `packages/<name>/` directory
3. Add a **changeset** describing the change: `pnpm changeset`
4. Open a PR
5. On merge, Changesets opens/updates a "Version Packages" PR
6. Merging that PR publishes to npm (gated by the `npm-publish` GitHub environment)

## Local setup

```bash
git clone git@github.com:iceglober/glrs.git
cd glrs
pnpm install
pnpm build          # builds all packages
pnpm test           # runs tests across all packages
pnpm typecheck      # typechecks all TS packages
```

## Changesets

Every user-visible PR must include a changeset. Run:

```bash
pnpm changeset
```

Pick the bump level per affected package, describe the change in plain English (user-facing, not implementation-detail), and commit the generated `.changeset/*.md` file with your PR.

### Bump-level cheat sheet

- **patch** — bug fixes, internal refactors, README edits to published packages
- **minor** — new features, new CLI subcommands, new exports (backward-compatible)
- **major** — breaking changes: removed/renamed exports, changed CLI surface, changed file-write locations, changed config-merge semantics, changed `~/.glorious/` paths, changed MCP tool signatures, etc.

When in doubt, lean **conservative** (bigger bump). It's cheaper for users than a surprise breakage.

## Cross-package changes

If your change touches multiple packages, create a single changeset that lists all affected packages with their respective bump levels:

```
---
"@glrs-dev/harness-opencode": minor
"@glrs-dev/agentic": patch
---

Added `glrs agentic wt switch` command and wired it into the harness prompt.
```

Inter-package dependencies bump automatically via Changesets' `updateInternalDependencies: patch` setting. You don't need to manually bump `@glrs-dev/cli` when one of its sub-packages changes — Changesets will patch-bump it for you.

## Package-specific contributing

Each package has its own `AGENTS.md` (for AI agents) and may have its own `CONTRIBUTING.md`:

- `packages/harness-opencode/AGENTS.md` — OpenCode plugin invariants
- `packages/agentic/` — CLI conventions
- `packages/assume/` — Rust toolchain + build matrix notes
- `packages/cli/` — dispatcher conventions

## Running a single package's tests

```bash
pnpm --filter @glrs-dev/harness-opencode test
pnpm --filter @glrs-dev/agentic test
pnpm --filter @glrs-dev/cli test
```

For Rust:

```bash
cd packages/assume && cargo test
```

## Releasing (maintainers only)

Do **not** run `npm publish` manually. The release pipeline is:

1. Merge a changeset PR to `main`
2. GitHub Actions opens/updates a "Version Packages" PR
3. Review the version bumps + CHANGELOG entries
4. Merge the Version Packages PR
5. GitHub Actions runs `changeset publish` → npm publish with provenance + git tags

The `npm-publish` environment requires maintainer approval before the publish step runs.

### Rollback

For a broken release:

```bash
npm deprecate @glrs-dev/<pkg>@<broken-version> "<reason>; use <fix-version>"
```

Then ship the fix via the normal flow. Users on floating semver auto-recover on next `pnpm update`.
