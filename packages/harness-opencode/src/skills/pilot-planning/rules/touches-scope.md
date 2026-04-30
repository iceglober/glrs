# Rule 4 — `touches:` scope tightness

**Globs must be the tightest set that lets the task succeed. `**` is a smell.**

The `touches:` list is the agent's leash. After verify passes, the worker computes `git diff --name-only` against the worktree's pre-task SHA; any path NOT matched by `touches:` is a violation and the task fails.

This catches:

- Agents that "helpfully" reformat unrelated files.
- Agents that modify a test in a far-away module to make verify pass.
- Agents that drift into copilot-style imports of unrelated utils.

Tight scopes also let v0.3's parallel scheduler safely run two tasks at once — if their touches don't intersect, they can't conflict.

## Heuristics

- **One module = one glob.** `src/api/**` and `test/api/**` for an API task. Not `src/**`.
- **Exact files when you know them.** `src/auth/login.ts` is better than `src/auth/**` if the task is just "edit login.ts".
- **Test files belong with their source files.** A task that adds source code almost always adds or edits a test. Both go in `touches:`.
- **Lock files: rarely.** `package.json` / `bun.lock` / `Cargo.lock` should appear ONLY when the task explicitly says "add a dependency". Don't include them speculatively.
- **Config files: rarely.** `tsconfig.json`, `.eslintrc`, `package.json` scripts — only if the task is about config.

## When `**` IS reasonable

- The task is a global rename / rewrite (across the whole repo).
- The task is "fix every TODO in the codebase" — touches everything by intent.
- The task explicitly says "this is a sweeping change".

In these cases, `**` is fine; the AGENT'S diligence becomes the constraint instead of the touches enforcement.

## What `touches: []` means

An empty `touches` list means the task **must NOT edit any files**. Use this for:

- Verify-only tasks (e.g., "confirm the existing tests still pass after a deps update was made by an upstream task").
- Probing tasks (e.g., "run benchmarks and report results" — though pilot doesn't yet have a "report results" mechanism, so this is rare).

If the verify commands would FAIL without edits, an empty `touches` is a STOP — the task is contradictory.

## Common mistakes

- **`touches: ["**/*.ts"]`** — too loose. Better: list the actual modules.
- **Forgetting tests.** Source-only `touches:` makes the task fail when the agent (correctly) edits the test file.
- **Forgetting docs.** If the task explicitly says "update README", README must be in `touches:`.
- **Including the migrations dir for a non-migration task.** Tight scope.

When in doubt, write the tightest possible scope first. If the task fails verify with "touches violation: src/X.ts", the worker shows you which file got touched — broaden then.

## `tolerate:` — files allowed in the diff but outside the contract

When a task's verify step runs a tool that writes files as a side-effect (codegen, build, snapshots), those files will appear in `git diff` even though the agent didn't author them. Add them to `tolerate:` so enforcement accepts them without counting them as part of the task's output.

Two categories to watch for:

**Built-in defaults (already tolerated — don't list these):**
- `**/next-env.d.ts` — Next.js regenerates on every `next build`.
- `**/.next/types/**`, `**/.next/dev/types/**` — Next.js app-router generated types.
- `**/*.tsbuildinfo` — TypeScript project-reference build cache.
- `**/__snapshots__/**`, `**/*.snap` — Jest / Vitest snapshot files rewritten by `-u`.

**Project-specific (list in `tolerate:` per task):**
- Prisma client output (e.g., `prisma/client/**` if `prisma generate` runs in verify).
- GraphQL codegen output (`graphql/generated/**`, `*.graphql.d.ts`).
- OpenAPI codegen output (`api-types/generated/**`).
- Anywhere you have a build step that writes type declarations downstream of the agent's source edits.

A good test: if the task's verify step runs `prisma generate`, `pnpm codegen`, `next build`, or similar, ask: "does that command write files anywhere?" If yes, those paths go in `tolerate:`.

### Example

```yaml
- id: T-ADD-RULE-MODEL
  touches:
    - prisma/schema.prisma
    - src/models/rule.ts
  tolerate:
    - prisma/client/**        # prisma generate output
  verify:
    - pnpm prisma generate
    - pnpm --filter core test rule-model
```
