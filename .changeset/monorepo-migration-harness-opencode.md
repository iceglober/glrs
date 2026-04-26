---
"@glrs-dev/harness-opencode": patch
---

Migrate to unified [`iceglober/glrs`](https://github.com/iceglober/glrs) monorepo. No functional changes; package name, bin names (`harness-opencode`, `glrs-oc`), CLI surface, install semantics, and all file-write invariants unchanged. The package now publishes from the monorepo's shared Changesets pipeline alongside `@glrs-dev/agentic`, `@glrs-dev/assume`, and `@glrs-dev/cli`. Source moved from `iceglober/harness-opencode` (now archived) to `iceglober/glrs/packages/harness-opencode/` with full git history preserved via `git-filter-repo`.
