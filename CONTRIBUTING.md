# Contributing to glrs

Thanks for contributing. This monorepo uses **Bun workspaces** and **Changesets**. The contributor flow is:

1. Fork + branch off `main`
2. Make your change in the relevant `packages/<name>/` directory
3. Add a **changeset** describing the change: `bun run changeset`
4. Open a PR
5. On merge, Changesets opens/updates a "Version Packages" PR
6. Merging that PR publishes to npm automatically (branch protection on `main` is the gate)

## Local setup

```bash
git clone git@github.com:iceglober/glrs.git
cd glrs
bun install
bun run build          # builds all packages
bun test               # runs tests across all packages
bun run typecheck      # typechecks all TS packages
```

## Changesets

Every user-visible PR must include a changeset. Run:

```bash
bun run changeset
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
"@glrs-dev/cli": patch
---

Added `glrs wt switch` command and wired it into the harness prompt.
```

Inter-package dependencies bump automatically via Changesets' `updateInternalDependencies: patch` setting. You don't need to manually bump `@glrs-dev/cli` when one of its sub-packages changes — Changesets will patch-bump it for you.

## Package-specific contributing

Each package has its own `AGENTS.md` (for AI agents) and may have its own `CONTRIBUTING.md`:

- `packages/harness-opencode/AGENTS.md` — OpenCode plugin invariants
- `packages/assume/` — Rust toolchain + build matrix notes
- `packages/cli/` — dispatcher conventions

## Running a single package's tests

```bash
bun run --filter @glrs-dev/harness-opencode test
bun run --filter @glrs-dev/cli test
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

The `main` branch protection rules are the publish gate — merging a Version Packages PR kicks off `changeset publish` automatically.

### Rollback

For a broken release:

```bash
npm deprecate @glrs-dev/<pkg>@<broken-version> "<reason>; use <fix-version>"
```

Then ship the fix via the normal flow. Users on floating semver auto-recover on next `bun update`.
