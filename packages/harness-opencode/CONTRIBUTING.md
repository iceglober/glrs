# Contributing

Thanks for contributing to `@glrs-dev/harness-opencode`. This repo is an npm-published OpenCode plugin; every change you merge flows to every user on their next `bun update`. Be deliberate.

For repo architecture, invariants, and rules about adding agents/skills/commands, read [`AGENTS.md`](./AGENTS.md) first — it's the source of truth for what this package is and how it's wired.

## Prerequisites

- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`).
- Repo cloned and dependencies installed: `bun install`.

## Making a change

1. Create a branch off latest `main`: `git fetch origin && git checkout -b <slug> origin/main`.
2. Make your change. Follow the rules in [`AGENTS.md`](./AGENTS.md).
3. Verify locally:
   ```bash
   bun run build
   bun run typecheck
   bun test
   ```
4. **Add a changeset** if your change is user-visible (see below).
5. Push your branch and open a PR.

## Adding a changeset

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and the changelog. Every user-visible PR must include a changeset file.

### When to add one

**Add a changeset for:**

- New or modified agents, skills, commands, or tools.
- Changes to MCP wiring or the plugin's public config surface.
- Bug fixes users will observe.
- Changes to prompt content that alter agent behavior.
- Dependency bumps that change runtime behavior.

**Skip changesets for:**

- Docs-only changes (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`, comments).
- Test-only changes (new tests, fixture updates, no source changes).
- Internal refactors with no user-observable effect.
- CI / tooling changes (`.github/**`, `tsup.config.ts`, `tsconfig.json`) that don't alter the shipped package.

If you're unsure, add one. A no-op `patch` changeset is cheap.

### How to add one

From the repo root:

```bash
bunx changeset
```

The CLI walks you through:

1. **Bump level** — `patch`, `minor`, or `major`. See the cheat sheet below.
2. **Summary** — a user-facing description. This ends up verbatim in `CHANGELOG.md`, so write it for someone who doesn't know this PR's context.

The CLI writes a file under `.changeset/` (e.g. `.changeset/fuzzy-mice-jump.md`). Commit it with your changes.

### Bump level cheat sheet for this plugin

| Bump | When |
|---|---|
| `major` | Breaking change to the plugin's public API, config keys, agent names, or behavior that existing users' workflows depend on. Requires intentional user action. |
| `minor` | New agents, new skills, new commands, new optional config, or other additive features. Safe for users to receive via `bun update`. |
| `patch` | Bug fixes, prompt tweaks that fix wrong behavior, internal changes that still want a release, dependency patch bumps. |

When in doubt, ask in the PR.

## How releases happen

You don't publish. The maintainer doesn't run `npm publish` either. Changesets does.

1. You merge a PR with a changeset into `main`.
2. The `release` workflow runs. It sees pending changesets and opens (or updates) a **"Version Packages" PR** that bumps `package.json`, aggregates the pending changesets into `CHANGELOG.md`, and deletes the consumed changeset files.
3. The maintainer reviews the Version Packages PR and merges it.
4. The `release` workflow runs again. This time there are no pending changesets, so it runs `changeset publish` — publishing to npm with [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) and pushing the git tag.

The `npm-publish` GitHub environment gates every publish with maintainer approval, so nothing reaches the registry silently.

## Tag format

Changesets creates tags in the form `@glrs-dev/harness-opencode@<version>` (e.g. `@glrs-dev/harness-opencode@0.1.3`).

Legacy tags `v0.1.1` and `v0.1.2` stay as historical references; we don't migrate them.

## Questions

Open a draft PR or an issue. The `release` workflow never triggers on PRs, so experimenting is safe.
