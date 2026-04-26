# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

## Adding a changeset

Every user-visible PR must include a changeset:

```bash
pnpm changeset
```

Pick the bump level (patch / minor / major) per affected package and describe the change. The tool creates a new markdown file in this folder — commit it with your PR.

## What happens on merge

The `release.yml` workflow on `main` either opens/updates a "Version Packages" PR or, if that PR is merged, runs `changeset publish` to push tags and publish to npm. The `npm-publish` GitHub environment gates every publish with maintainer approval.

## Bump-level cheat sheet

- **patch** — bug fixes, internal refactors, doc-only changes that affect the published README
- **minor** — new features, new exports, new CLI subcommands (backward-compatible)
- **major** — breaking changes: removed/renamed exports, changed CLI behavior, changed file-write locations, changed config-merge semantics

## Linked packages

`@glrs-dev/assume` and its five platform siblings (`-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`, `-win32-x64`) are in a linked group — they always publish at the same version. A changeset on any of them bumps all six.
