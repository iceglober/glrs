# Rule 3 — Verify-command design

**Each task's `verify:` commands must succeed iff the task is correctly done.**

The verify list is the contract between the planner and the builder. It is the ONLY signal pilot uses to decide "did this task work?". A weak verify means you're shipping work the run thinks is fine but really isn't. An over-broad verify means the task fails for reasons unrelated to the work — pre-existing test failures, missing infrastructure, flaky integration tests — and the agent wastes its retry budget on something it can't fix.

## The cardinal rule: verify ONLY what the task changed

A verify command must exercise **exactly the code the task produced** — no more, no less. If the task adds `src/entities/audit-log/schema.ts` and its test file, the verify is:

```yaml
verify:
  - pnpm --filter @kn/core test -- --run src/entities/audit-log/__tests__/schema.test.ts
```

NOT:

```yaml
verify:
  - pnpm --filter @kn/core test -- --run src/entities/audit-log
```

The second form runs EVERY test under that directory — including integration tests that need a running database, tests for pre-existing code the task didn't touch, and tests that may already be failing on the base branch. The agent cannot fix those failures. It will exhaust its retry budget and STOP.

**The verify command's scope must be as tight as the `touches:` scope.** If you wouldn't put a file in `touches:`, don't let the verify command exercise it.

## What a good verify looks like

- `pnpm test -- --run path/to/specific.test.ts` — runs ONE test file
- `bun test test/api/specific.test.ts` — same, bun flavor
- `bun run typecheck` — semantic check, catches real type failures (good as `verify_after_each`)
- `node scripts/check-schema.ts` — your own probe script (write it as part of the task)
- `grep -q 'export function newThing' src/file.ts && bun test test/file.test.ts` — existence + behavior

## What's not OK

- `echo done` — proves nothing
- `test -f src/foo.ts` — file existence is necessary but rarely sufficient
- `bun run build` ALONE — build success without tests means "TypeScript was happy"; insufficient for behavior tasks
- `pnpm test` (whole package) — pulls in every test in the package; pre-existing failures block the task
- `pnpm --filter @pkg test -- --run src/module` (directory-level) — same problem; runs integration tests the task didn't write
- `grep -q 'newFunction' src/file.ts` — proves text presence, not behavior
- `git diff --name-only | grep src/api` — proves edits happened, not that they're correct

## The pre-existing-failure trap

Pilot runs a **baseline check** before the agent starts: every verify command is executed on the clean tree. If ANY command fails in baseline, the task aborts immediately with a clear message:

> baseline verify failed: `pnpm --filter @kn/core test` → exit 1.
> This command fails on the clean tree BEFORE the agent starts —
> fix your environment or narrow the verify scope.

This prevents the agent from wasting its 5-attempt retry budget on failures it didn't cause and can't fix. The baseline is the planner's contract: "these commands WILL pass if the environment is set up correctly."

**If your verify command fails in baseline, the fix is one of:**
1. Start the missing infrastructure (the setup hook should handle this).
2. Narrow the verify to only the specific test file the task creates.
3. Fix the pre-existing test failure on the base branch first.

The agent gets 5 attempts (with escalating "try a different approach" nudges) for failures it introduces AFTER the baseline passes. Pre-existing failures never reach the agent.

## Milestone and defaults verify run in the baseline too

The baseline check doesn't only run task-specific verify commands — it runs **everything except** the task's own `verify:` list. That means:

- `defaults.verify_after_each` commands
- The task's milestone `verify` commands
- `pilot.json` `baseline` and `after_each` commands

These commands run on the clean tree **before every task in their scope**. If a milestone verify is `pnpm --filter @pkg test` and the first task in that milestone scaffolds the package with a test runner config but zero test files, the *second* task's baseline fails — vitest/jest exit 1 on "no test files found", and the entire downstream DAG cascades to failure.

**The rule: every milestone and defaults verify command must pass at every point in the DAG where it applies — including immediately after scaffold tasks that create zero test files.**

### The empty-test-suite trap

Test runners treat "no test files found" as a failure by default:

| Runner | Behavior on zero tests | Fix |
|---|---|---|
| vitest | exit 1 | `--passWithNoTests` |
| jest | exit 1 | `--passWithNoTests` |
| bun test | exit 0 (safe by default) | — |

When a plan scaffolds a new package or module, the scaffold task creates the test runner config but typically no test files — the first real task creates those. Any milestone or defaults verify that runs the package's test suite will hit the empty-suite exit code.

**Fix: always use `--passWithNoTests` (or equivalent) on milestone and defaults verify commands that run a test suite.** This is not a weakening of the verify — it's acknowledging that "zero tests, zero failures" is a valid baseline state for a package under construction.

```yaml
# WRONG — fails baseline after scaffold task
milestones:
  - name: M1-ENGINE
    verify:
      - pnpm --filter @pkg test

# RIGHT — tolerates the empty state between scaffold and first real task
milestones:
  - name: M1-ENGINE
    verify:
      - pnpm --filter @pkg test -- --passWithNoTests
```

Task-specific verify does NOT need `--passWithNoTests` — it targets the exact test file the task creates, and the baseline excludes task-specific verify commands (they'd fail before the task runs by design — that's TDD).

## Two-tier verify

Use BOTH a per-task verify and `defaults.verify_after_each`:

```yaml
defaults:
  verify_after_each:
    - bun run typecheck     # always must pass — catches cross-file breakage
tasks:
  - id: T1
    verify:
      - bun test test/api/create-rule.test.ts   # task-specific behavior proof
```

`verify_after_each` catches global breakage (a syntax error in a file the task didn't even touch); per-task verify catches task-specific behavior. Together they form a tight net without over-reaching.

## Touches and verify must agree

If the task `touches: [src/api/rules.ts, test/api/rules.test.ts]` but the verify command runs `bun test test/web/`, you have a wrong scope. The verify must exercise files in the touched scope — and ONLY those files.

Conversely: if the verify runs `test/api/rules.test.ts` but `touches:` doesn't include `test/api/rules.test.ts`, the agent can't create or edit that test file. Both must agree.

## Verify must be deterministic and self-contained

- No `sleep` to wait for a service that may not start.
- No external network calls that could flake — mock or skip.
- No dependency on infrastructure the setup hook didn't start. If the verify needs postgres, the setup hook must start it. If the verify needs an API server, the setup hook must start it.
- No dependency on other tasks' output being committed (use `depends_on` to sequence).

If a verify command flakes, three retries will exhaust attempts and the task fails for environmental reasons. Pilot has no way to distinguish "real failure" from "flake".

## Always include a "before" check

For non-trivial tasks, write a verify that would HAVE FAILED before the task ran. This makes the task's value observable. If the verify passed before AND passes after, the task didn't actually move the system.

Good pattern: the test file the agent creates IS the "before" check — it didn't exist before, so `bun test path/to/new.test.ts` would have failed (file not found). After the task, it exists and passes.

## Port and environment awareness

If the setup hook starts services on non-default ports (to avoid collisions with the user's dev stack), verify commands must use those ports. Two patterns:

**A. Source the env file the hook wrote:**
```yaml
verify:
  - bash -c 'source .env.pilot && pnpm --filter @pkg test -- --run path/to/test.ts'
```

**B. Use `defaults.verify_after_each` for the env-sourcing wrapper:**
```yaml
defaults:
  verify_after_each:
    - bash -c 'source .env.pilot && bun run typecheck'
```

**C. Tests read from `process.env` at runtime** (best — no wrapper needed):
If the test framework reads `DATABASE_URL` from the environment, and the setup hook exports it, the verify command just works. This is the cleanest pattern.

## Cross-reference: per-surface tooling menu

For the per-surface tooling menu (Playwright for UI, curl for API, Postgres for DB), see rule 9 (`qa-expectations.md`). That rule applies these principles to specific tools; this rule defines the principles themselves.
