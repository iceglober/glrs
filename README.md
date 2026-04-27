# glrs

**Unified [@glrs-dev](https://www.npmjs.com/org/glrs-dev) ecosystem.** One monorepo, one release cadence, one docs site.

Docs: **[glrs.dev](https://glrs.dev)**

## Packages

| Package | npm | What it is |
|---|---|---|
| [`@glrs-dev/cli`](./packages/cli) | `@glrs-dev/cli` | Single `glrs` binary. Dispatches to harness-opencode and provides worktree management. |
| [`@glrs-dev/harness-opencode`](./packages/harness-opencode) | `@glrs-dev/harness-opencode` | OpenCode agent harness — PRIME, plan, build, QA, skills, MCP wiring. |
| [`@glrs-dev/assume`](./packages/assume) | `@glrs-dev/assume` (+ [crates.io](https://crates.io/crates/glrs-assume)) | Rust-based SSO credential manager for AWS/GCP. Bins: `gs-assume`, `gsa`. |

## Quick start

```bash
# Install the unified CLI
npm i -g @glrs-dev/cli

# Use subcommands
glrs oc install
glrs wt new my-feature

# Install assume separately (standalone Rust package)
npm i -g @glrs-dev/assume
gsa login aws
```

Each package still ships its own bin for direct use:

```bash
harness-opencode install
gsa login aws
```

## Development

```bash
bun install
bun run build
bun test
bun run typecheck
```

This repo uses **Bun workspaces**, **Changesets** for versioning + publishing. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Releases

Automated via [Changesets](https://github.com/changesets/changesets):

1. Include a changeset in every user-visible PR: `bun run changeset`
2. On merge to `main`, a "Version Packages" PR opens / updates
3. Merging the Version Packages PR publishes to npm and tags releases

The `npm-publish` GitHub environment gates every publish with maintainer approval.

## History

This monorepo consolidates two archived repos:
- [`iceglober/harness-opencode`](https://github.com/iceglober/harness-opencode) → `packages/harness-opencode/` (history preserved)
- [`iceglober/glorious`](https://github.com/iceglober/glorious) → `packages/assume/` (history preserved)

## License

MIT — see [`LICENSE`](./LICENSE).
