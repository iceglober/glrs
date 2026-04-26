# glrs

**Unified [@glrs-dev](https://www.npmjs.com/org/glrs-dev) ecosystem.** One monorepo, one release cadence, one docs site.

Docs: **[glrs.dev](https://glrs.dev)**

## Packages

| Package | npm | What it is |
|---|---|---|
| [`@glrs-dev/cli`](./packages/cli) | `@glrs-dev/cli` | Single `glrs` binary. Dispatches to the three sub-tools below. |
| [`@glrs-dev/harness-opencode`](./packages/harness-opencode) | `@glrs-dev/harness-opencode` | OpenCode agent harness — PRIME, plan, build, QA, skills, MCP wiring. |
| [`@glrs-dev/agentic`](./packages/agentic) | `@glrs-dev/agentic` | CLI for agentic workflows, worktree management, plan state. Bins: `gs-agentic`, `gsag`. |
| [`@glrs-dev/assume`](./packages/assume) | `@glrs-dev/assume` (+ [crates.io](https://crates.io/crates/glrs-assume)) | Rust-based SSO credential manager for AWS/GCP. Bins: `gs-assume`, `gsa`. |

## Quick start

```bash
# Install the unified CLI
npm i -g @glrs-dev/cli

# Use subcommands
glrs oc install
glrs agentic wt new my-feature
glrs assume login aws
```

Each package still ships its own bin for direct use:

```bash
harness-opencode install
gsag wt new my-feature
gsa login aws
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

This repo uses **pnpm workspaces** + **turborepo** for builds, **Changesets** for versioning + publishing. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Releases

Automated via [Changesets](https://github.com/changesets/changesets):

1. Include a changeset in every user-visible PR: `pnpm changeset`
2. On merge to `main`, a "Version Packages" PR opens / updates
3. Merging the Version Packages PR publishes to npm and tags releases

The `npm-publish` GitHub environment gates every publish with maintainer approval.

## History

This monorepo consolidates two archived repos:
- [`iceglober/harness-opencode`](https://github.com/iceglober/harness-opencode) → `packages/harness-opencode/` (history preserved)
- [`iceglober/glorious`](https://github.com/iceglober/glorious) → `packages/agentic/` and `packages/assume/` (history preserved)

## License

MIT — see [`LICENSE`](./LICENSE).
