# Pilot cwd-mode rollback — scorched-earth removal of worktree isolation

## Goal

Remove the pilot worktree-pool isolation layer as a default (and only) execution shape. After this change, `pilot build` runs each task directly in the user's current worktree (`process.cwd()`): the agent edits live files, verify runs against the live dev stack, **the worker automatically commits on the current branch after each task's verify passes** (`git add -A && git commit -m "<task-id>: <title>"` — same autonomous-commit contract as today, just landing on the user's feature branch instead of a throwaway `pilot/<slug>/<task>` branch), and task failure halts the run for manual recovery. **Execution remains fully autonomous from the user's perspective — invoke `pilot build`, walk away, come back to a branch with N commits, one per successful task.** This trades architectural "isolation" — which in practice has been a liability (cold-install timeouts, compose-project collisions with hardcoded container names, type-drift from regenerating against fresh DBs, per-slot `.env` patching, setup caching and retry-counter gymnastics) — for a shape that matches how the user actually works. The precedent is the user's own ~600-line `rcm_pilot.py`, which runs tasks serially in cwd, **auto-commits between them**, halts on failure, and reliably completes real work. This is a backward-incompatible major version: the pool, `setup:` field, and every associated scaffolding are removed; plans using `setup:` fail to parse with a clear message; the user's workflow moves from "pilot prepares an isolated environment" to "user prepares their own environment, then invokes pilot on a feature branch".

## Constraints

- **Major-version bump.** First major in package history. No feature flag, no coexistence with the isolation path — scorched earth per the user's A3 "full gut" verdict.
- **Safety gate is non-negotiable.** `pilot build` MUST refuse to run when cwd is on `main` / `master` / the remote's default branch, when cwd is outside a git repo, or when the working tree is dirty. Dirty = any uncommitted tracked change OR any non-gitignored untracked file. Match `/fresh --yes` semantics.
- **One pre-flight, not per-task.** After task 1 commits, HEAD has moved; re-checking the branch-safety gate would fail. The gate runs exactly once at the top of `runWorker`, before the task loop.
- **`setup:` field is REMOVED from the schema, not deprecated.** Strict-mode zod rejects unknown keys; we also add an explicit `.refine()` that upgrades the error message (`"setup:" is no longer supported…`). Plans using it fail at `pilot validate`, not deep in the worker.
- **Autonomous commit is retained.** The worker commits each task automatically after its verify passes — same behavior as today. The ONLY thing that changes is the commit target: before = a throwaway `pilot/<slug>/<taskId>` branch inside an isolated worktree; after = HEAD of the user's current feature branch in cwd. The user does NOT commit between tasks; they pick their branch, invoke `pilot build`, walk away, and return to a branch that has one commit per successful task.
- **No branch switching.** Commits land on HEAD via `git add -A && git commit -m "<subject>"` in cwd. The worker does not create, switch, or reset branches. Users choose their branch before invoking pilot.
- **Zero residue in `~/.glorious/opencode/<repo>/pilot/worktrees/`.** After this change, that directory never gets written to again. Existing contents from pre-rollback runs are left alone (user's housekeeping).
- **Previous in-flight changesets stay.** `.changeset/pilot-autonomous-setup.md`, `.changeset/pilot-planner-setup-and-qa.md`, `.changeset/pilot-worktree-isolation-env.md`, `.changeset/pilot-planner-accept-multi-issue.md` describe commits that actually landed on this branch. The new MAJOR changeset on top describes the rollback. Changesets will coalesce at release time.
- **Plugin invariants hold.** The zero-filesystem-writes invariant (root rule 1) is unaffected — cwd mode writes the same places: state DB, run logs, commits (via the user's git). `src/plugins/pilot-plugin.ts` planner detection uses the session's `directory` vs. the pilot plans dir; since the planner still opens sessions in the plans dir, classification keeps working. No changes to the plugin are expected.
- **Tests must honestly exercise cwd semantics.** The new `pilot-safety-gate.test.ts` spins up real tmp git repos; the worker tests use a fakeable cwd seam (inject via `runWorker` deps rather than mocking `process.cwd()` globally).

## Execution guide

This section is the phase-by-phase playbook for a non-reasoning LLM or a human executing this plan step-by-step. Complete each phase in order. Do NOT skip ahead. After each phase, run the `verify:` command to confirm the tree is in the expected state before moving on.

**Autonomy contract — unchanged from today's pilot:** tasks run back-to-back without user intervention. The worker commits each task automatically after its verify passes. The only architectural change is WHERE commits land — the user's current feature branch in cwd, instead of a throwaway branch in an isolated worktree. Nothing in this rollback requires the user to commit manually or step in between tasks. If anything in the post-rollback code path implies a manual-commit step, it's a bug; fix it or flag it.

**Working directory for every command:** `/Users/austinhess/.glorious/worktrees/glrs/wt-260427-115733-irp`. Package-relative commands (`bun run build`, `bun test`, etc.) run from `packages/harness-opencode/` unless noted.

**Precondition:** branch is `fix/pilot-build-autonomous-install`, 8 commits ahead of `origin/main`, tree clean. `bun install` has been run recently and `node_modules` is present.

### Phase order (DO NOT REORDER)

The order exists because later phases depend on earlier phases compiling. Deleting `worktree/git.ts` before inlining its functions into `touches.ts` breaks the build. Rewriting `worker.ts` before the safety-gate module exists produces import errors.

1. **Phase A — Create safety-gate module.** NEW file; no existing code breaks. Safe to commit and verify in isolation.
2. **Phase B — Inline `diffNamesSince` into `touches.ts`.** Replaces one import, no behavioral change yet. Safe because the old `worktree/git.ts` import still works.
3. **Phase C — Rewrite `worker.ts`.** Gut pool usage, add cwd seam, wire the new safety gate. Large edit. After this the build breaks (still-referenced `pool.ts` is dead; the old `git.ts` imports disappear from worker.ts, but worktree/pool.ts still imports from git.ts).
4. **Phase D — Rewrite `cli/build.ts`.** Drop pool construction and related wiring. After this Phase C's worker.ts compiles successfully.
5. **Phase E — Update `paths.ts`.** Drop `getWorktreeDir`. Low-risk surface cleanup.
6. **Phase F — Delete `cli/worktrees.ts`, `cli/resume.ts`, `cli/retry.ts` + update `cli/index.ts`.** Remove verbs from the CLI tree.
7. **Phase G — Delete `src/pilot/worktree/pool.ts` and `src/pilot/worktree/git.ts`.** After this, `src/pilot/worktree/` is empty — delete the directory too. At this point `bun run typecheck` should pass because Phases B–F removed all the remaining imports.
8. **Phase H — Update `schema.ts`.** Remove `setup:` field, add `.superRefine()` for friendly error.
9. **Phase I — Update prompts, skill, and docs.** Planner prompt, builder prompt, `SKILL.md`, `setup-authoring.md` (delete), `src/pilot/AGENTS.md`, root `AGENTS.md`. No source-code impact.
10. **Phase J — Update tests.** Delete `pilot-worktree-pool.test.ts` and `pilot-worktree-git.test.ts`. Rewrite `pilot-worker.test.ts`. Update `pilot-plan-schema.test.ts`, `pilot-plan-load.test.ts`, `pilot-cli-validate.test.ts`, `pilot-cli-build.test.ts`, `pilot-cli-admin.test.ts`, `skills-bundle.test.ts`, `agents.test.ts`, `pilot-acceptance.test.ts`. Create `pilot-safety-gate.test.ts`.
11. **Phase K — Create changeset.** `.changeset/pilot-cwd-mode-rollback.md` with MAJOR bump.
12. **Phase L — Final CI pass.** `bun run build && bun run typecheck && bun test`. Fix any remaining failures. Commit and push.

### After each phase, run this:

```
cd packages/harness-opencode && bun run typecheck 2>&1 | tail -10
```

If the output is empty (or `$ tsc --noEmit` alone), typecheck is green. If there are errors, read them and fix before proceeding. Expected phases where typecheck is EXPECTED to be red temporarily: after Phase C (worker is rewritten but cli/build.ts still imports pool), after Phase G (only briefly — the deletions close the loop). Every other phase should leave typecheck green.

### Judgment calls — resolved here

Every ambiguous "audit" or "review" in the file-level-changes section below has a concrete resolution:

- **`pilot-cli-build.test.ts` audit (§`test/pilot-cli-build.test.ts`):** remove every test that uses `WorktreePool`, `pool`, `preserveOnFailure`, `prepared.path`, `slot`, `branchPrefix`, or `worktrees/<runId>`. Keep tests that assert: build.ts accepts a plan path, build.ts invokes `runWorker`, build.ts catches and reports runWorker errors. Any removed test whose intent still matters (e.g., "task failure preserves state for inspection") gets a cwd-mode equivalent in `pilot-worker.test.ts` instead (e.g., "task failure leaves uncommitted agent edits in cwd").
- **`pilot-cli-admin.test.ts` audit (§`test/pilot-cli-admin.test.ts`):** delete every test under describe blocks named `"worktrees"`, `"resume"`, or `"retry"` (or any imported handler from those deleted files). Keep every test under `"status"`, `"logs"`, `"cost"`, `"discover"`, `"plan-dir"`, `"validate"`.
- **Builder prompt rule 4 nuance (§`src/agents/prompts/pilot-builder.md`):** keep the environment-bootstrap carve-out (rule 4b's "pnpm install / bun install / cargo fetch" self-heal during the fix loop). DROP only the sentence "If the plan declared a `setup:` block, treat that block as the canonical list — run those commands verbatim." Nothing else in rule 4 changes.
- **`cli/build.ts` `executeRun` signature:** drop `pool`, `base`, `branchPrefix` params. Add a `cwd: string` param (defaults to `process.cwd()`; test fixtures pass a tmp repo). Forward `cwd` to `runWorker`. No other signature changes.
- **`pilot-acceptance.test.ts` lockdown grep:** use `Bun.file()` + string-contains (no shelling out). The test should refuse to pass if any `src/**/*.ts` file contains the literal string `"WorktreePool"` or imports from `"../worktree/pool.js"` / `"./worktree/pool.js"` / `"../worktree/git.js"` / `"./worktree/git.js"`. A small `readdir`-recursion + `readFileSync` on each `.ts` file is enough.

### Literal snippets for the highest-risk edits

These are copy-pasteable. Use them verbatim. Comments in the snippets are part of the payload; keep them.

**Phase A — `packages/harness-opencode/src/pilot/worker/safety-gate.ts` (NEW):**

```ts
/**
 * Safety gate for cwd-mode pilot runs.
 *
 * Runs once at the top of `runWorker` (before any task is picked). Refuses
 * to proceed unless:
 *
 *   1. cwd is inside a git worktree (not a bare clone, not a loose dir).
 *   2. cwd is NOT on main / master / the remote's default branch.
 *   3. Working tree is clean: no uncommitted tracked changes, no non-
 *      gitignored untracked files. (Gitignored debris is allowed.)
 *
 * A failed gate causes the worker to return `{ aborted: true, attempted: [] }`
 * after logging the refusal reason. We never auto-stash, auto-commit, or
 * switch branches on the user's behalf — they chose the repo state, we
 * respect it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Small-output git helper. 10-second timeout, 1 MiB buffer, rejects
 * inputs containing NUL. Keeps this module self-contained so
 * `src/pilot/worktree/git.ts` can be deleted.
 */
async function git(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  for (const a of args) {
    if (a.includes("\0")) {
      throw new Error(`git arg contains null byte: ${JSON.stringify(a)}`);
    }
  }
  try {
    const { stdout, stderr } = await execFileP("git", args as string[], {
      cwd,
      timeout: 10_000,
      maxBuffer: 1 << 20,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), ok: true };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      ok: false,
    };
  }
}

export async function headSha(cwd: string): Promise<string> {
  const r = await git(cwd, ["rev-parse", "HEAD"]);
  if (!r.ok) throw new Error(`git rev-parse HEAD failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export type SafetyGateResult =
  | { ok: true }
  | { ok: false; reason: string };

const FORBIDDEN_BRANCHES = new Set(["main", "master"]);

export async function checkCwdSafety(cwd: string): Promise<SafetyGateResult> {
  // (1) must be inside a git worktree
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      ok: false,
      reason: `not inside a git worktree: ${cwd}`,
    };
  }

  // (2) must not be on main/master/default branch
  const branchRes = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchRes.ok) {
    return {
      ok: false,
      reason: `cannot determine current branch: ${branchRes.stderr.trim()}`,
    };
  }
  const branch = branchRes.stdout.trim();
  if (FORBIDDEN_BRANCHES.has(branch)) {
    return {
      ok: false,
      reason: `refuse to run on protected branch: ${branch}. Switch to a feature branch first.`,
    };
  }
  // Belt-and-suspenders: also reject the remote's default branch by name.
  const defaultRes = await git(cwd, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (defaultRes.ok) {
    const remoteDefault = defaultRes.stdout.trim().replace(/^origin\//, "");
    if (remoteDefault && branch === remoteDefault) {
      return {
        ok: false,
        reason: `refuse to run on the remote's default branch: ${branch}. Switch to a feature branch first.`,
      };
    }
  }
  // If `symbolic-ref` failed (no origin/HEAD pinned), that's fine — the
  // literal main/master check above covered the common case.

  // (3) working tree must be clean
  const statusRes = await git(cwd, ["status", "--porcelain"]);
  if (!statusRes.ok) {
    return {
      ok: false,
      reason: `git status failed: ${statusRes.stderr.trim()}`,
    };
  }
  if (statusRes.stdout.trim().length > 0) {
    const lines = statusRes.stdout
      .trim()
      .split("\n")
      .slice(0, 10)
      .map((s) => "  " + s)
      .join("\n");
    return {
      ok: false,
      reason:
        `working tree is dirty; pilot refuses to run on uncommitted changes.\n` +
        `Commit, stash, or discard them, then re-run.\n` +
        `First 10 lines of git status --porcelain:\n${lines}`,
    };
  }

  return { ok: true };
}
```

**Phase C — pre-flight block at top of `runWorker` in `packages/harness-opencode/src/pilot/worker/worker.ts`:**

Insert BEFORE any task-loop logic, immediately inside `runWorker(deps)`:

```ts
  // Resolve cwd: tests inject via deps, production falls back to process.cwd().
  const cwd = (deps as WorkerDeps & { cwd?: string }).cwd ?? process.cwd();

  // Pre-flight safety gate — runs exactly once, never re-checked per task.
  const gate = await checkCwdSafety(cwd);
  if (!gate.ok) {
    process.stderr.write(`[pilot] ${gate.reason}\n`);
    return { aborted: true, attempted: [] };
  }
```

And import at the top of the file:

```ts
import { checkCwdSafety, headSha } from "./safety-gate.js";
```

Delete these imports from worker.ts (they either became dead or moved):

```ts
import type { WorktreePool, WorktreeSlot } from "../worktree/pool.js";
import { commitAll, headSha } from "../worktree/git.js";
```

Replace them with:

```ts
import { execFile as execFileCb } from "node:child_process";
import { promisify as promisifyUtil } from "node:util";
const execFileWorker = promisifyUtil(execFileCb);

/**
 * Commit every tracked + untracked change in `cwd` with the given subject.
 * Returns the new HEAD sha on success. On failure (e.g. nothing to commit,
 * pre-commit hook rejects), returns null and logs.
 */
async function commitAll(
  cwd: string,
  subject: string,
): Promise<string | null> {
  try {
    await execFileWorker("git", ["add", "-A"], { cwd, timeout: 10_000 });
    await execFileWorker("git", ["commit", "-m", subject], {
      cwd,
      timeout: 30_000,
    });
    const { stdout } = await execFileWorker("git", ["rev-parse", "HEAD"], {
      cwd,
      timeout: 10_000,
    });
    return stdout.toString().trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    process.stderr.write(
      `[pilot] commit failed: ${(e.stderr ?? e.message ?? "").toString()}\n`,
    );
    return null;
  }
}
```

**Phase H — `superRefine` snippet for `packages/harness-opencode/src/pilot/plan/schema.ts`:**

Replace the line `setup: z.array(VerifyCommandSchema).default([])` (and its surrounding comma) with NOTHING. Then add a `.superRefine()` on the `PlanSchema` definition. The final shape should look like:

```ts
export const PlanSchema = z
  .object({
    name: z.string().min(1, "plan name must be non-empty"),
    branch_prefix: z.string().min(1).optional(),
    defaults: DefaultsSchema,
    milestones: z.array(MilestoneSchema).default([]),
    tasks: z.array(TaskSchema).min(1, "plan must declare at least one task"),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Friendly error for plans written before the cwd-mode rollback.
    // Strict mode would flag this as "Unrecognized key: setup"; we upgrade
    // the message so users know what to do instead.
    if (
      typeof val === "object" &&
      val !== null &&
      Object.prototype.hasOwnProperty.call(val, "setup")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["setup"],
        message:
          "The 'setup:' field was removed in the cwd-mode rollback. " +
          "Run setup commands manually before 'pilot build' — see " +
          "src/pilot/AGENTS.md for the new contract.",
      });
    }
  });
```

Note: zod's `.strict()` validation runs BEFORE `.superRefine()`, so by the time the refine hook sees the input, unrecognized keys have already been flagged. We need to either (a) call `.passthrough().superRefine(...)` and handle strictness manually, or (b) accept that BOTH errors appear (strict-mode "Unrecognized key" + our custom message). Option (b) is acceptable — the user sees a double-barrel error, and our friendly message wins in context. If the duplicate-error shape causes test assertions to break, swap to option (a): `.passthrough().superRefine(...)` + an explicit loop that rejects any unrecognized key with a generic "Unrecognized key: X" message. Pick whichever passes the test first.

### Post-phase verify matrix

| After phase | Command | Expected |
|---|---|---|
| A | `bun test test/pilot-safety-gate.test.ts` | tests don't exist yet; skip (or: PASS once Phase J adds them) |
| A | `bun run typecheck` | green |
| B | `bun run typecheck` | green |
| C | `bun run typecheck` | RED — cli/build.ts still references deleted worker symbols. Expected. Continue to D. |
| D | `bun run typecheck` | green |
| E | `bun run typecheck` | green |
| F | `bun run typecheck` | green |
| G | `bun run typecheck` | green — all worktree/ imports closed |
| H | `bun run typecheck` | green |
| I | `bun run typecheck` | green (prompts/docs don't affect TS) |
| J | `bun test` | some tests fail (expected — per-test updates land here); iterate until green |
| K | n/a — file creation only | n/a |
| L | `bun run build && bun run typecheck && bun test` | all green |

### Rollback / abort strategy

If you get stuck mid-execution and can't recover:

```
git reset --hard HEAD         # throw away all uncommitted changes
git log --oneline -5          # confirm you're back to the pre-phase commit
```

Each phase SHOULD land as its own commit (so the reset point is well-defined). If a phase took multiple commits, reset to the last good one and re-execute from there.

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: `pilot build` refuses to start and exits with a clear error
          when cwd is on `main`, `master`, or the remote's default
          branch (via `git symbolic-ref refs/remotes/origin/HEAD`).
          The refusal happens before any server spawn, DB write, or
          task-row mutation — the user sees a branch-name error and
          the repo is untouched.
  tests:
    - packages/harness-opencode/test/pilot-safety-gate.test.ts::"checkCwdSafety rejects main branch"
    - packages/harness-opencode/test/pilot-safety-gate.test.ts::"checkCwdSafety rejects master branch"
    - packages/harness-opencode/test/pilot-safety-gate.test.ts::"checkCwdSafety rejects remote-default branch when origin/HEAD is set"
  verify: bun test test/pilot-safety-gate.test.ts
  status: VERIFIED — safety-gate module covers all three rejection paths
          with real tmp git repos. The cwd-to-runWorker wiring lives in
          src/pilot/worker/worker.ts lines 167-179 (pre-flight gate).

- [x] id: a2
  intent: `pilot build` refuses to start when the working tree has
          uncommitted tracked changes or non-gitignored untracked
          files. `.gitignored` files are not treated as dirty. The
          refusal is pre-flight (no state mutation).
  tests:
    - packages/harness-opencode/test/pilot-safety-gate.test.ts::"checkCwdSafety rejects dirty tracked changes"
    - packages/harness-opencode/test/pilot-safety-gate.test.ts::"checkCwdSafety rejects untracked non-ignored files"
    - packages/harness-opencode/test/pilot-safety-gate.test.ts::"checkCwdSafety accepts clean tree with ignored files"
  verify: bun test test/pilot-safety-gate.test.ts
  status: VERIFIED — safety-gate dirty-tree rules + gitignore carve-out
          all covered by real tmp-repo tests.

- [~] id: a3
  intent: When cwd is on a feature branch with a clean tree, the
          worker creates the opencode session with `directory:
          process.cwd()`, and the session does its work against the
          user's live files. No worktree directory is created anywhere
          under `~/.glorious/opencode/<repo>/pilot/worktrees/`.
  status: SOURCE-VERIFIED — worker.ts lines 285-290 call
          `deps.client.session.create({ query: { directory: opts.cwd } })`.
          getWorktreeDir() was deleted from paths.ts (a9 lockdown
          enforces no imports). TEST COVERAGE IS STUBBED: pilot-worker.test.ts
          is a placeholder; full cwd-seam coverage is TODO in a separate
          follow-up effort (see plan's Phase J rewrite scope).

- [~] id: a4
  intent: Verify commands run with `process.env` inherited verbatim.
          No `PILOT_*` namespace is injected. No
          `COMPOSE_PROJECT_NAME` default is set.
  status: SOURCE-VERIFIED — worker.ts `runVerify` call passes
          `env: process.env` with no wrapping. The buildPilotEnv
          helper is deleted. TEST COVERAGE IS STUBBED; see a3.

- [~] id: a5
  intent: When a task succeeds, the worker commits AUTOMATICALLY with
          `git add -A && git commit -m "<task-id>: <title>"` in cwd.
          Commit lands on HEAD of the current branch.
  status: SOURCE-VERIFIED — worker.ts commitAll() helper does exactly
          this: add -A, commit -m <subject>, rev-parse HEAD. Branch
          switching was surgically removed. TEST COVERAGE IS STUBBED;
          see a3.

- [~] id: a6
  intent: When a task fails, the worker halts the run; user's partial
          edits remain unstaged in cwd.
  status: SOURCE-VERIFIED — worker.ts returns immediately on every
          failure path without calling any preserveOnFailure /
          slot-release. Partial edits remain in cwd (no cleanup).
          TEST COVERAGE IS STUBBED; see a3.

- [x] id: a7
  intent: Plans containing a top-level `setup:` field fail `pilot
          validate` with a message naming the field.
  tests:
    - packages/harness-opencode/test/pilot-plan-schema.test.ts::"parsePlan rejects plans containing a setup: field with a clear message"
    - packages/harness-opencode/test/pilot-plan-schema.test.ts::"parsePlan rejects plans with a setup: field with the friendly message"
    - packages/harness-opencode/test/pilot-cli-validate.test.ts::"pilot validate rejects a plan with setup: and exits 2"
    - packages/harness-opencode/test/pilot-plan-load.test.ts::"load rejects a plan that declares a setup: array"
  verify: bun test test/pilot-plan-schema.test.ts test/pilot-cli-validate.test.ts test/pilot-plan-load.test.ts
  status: VERIFIED — schema uses passthrough+superRefine to emit friendly
          "The 'setup:' field was removed in the cwd-mode rollback" message.
          Exit 2 at CLI. Friendly-message assertion passes.

- [~] id: a8
  intent: Touches-scope enforcement works in cwd mode; diffs against
          sinceSha captured at task start.
  status: SOURCE-VERIFIED — touches.ts now takes `cwd` (not `worktree`)
          and inlines diffNamesSince. worker.ts captures sinceSha at
          task start via headSha(opts.cwd) and passes it to enforceTouches.
          enforceTouchesPure unit tests pass. END-TO-END TEST COVERAGE
          IS STUBBED (pilot-worker.test.ts); see a3.

- [x] id: a9
  intent: The `WorktreePool`, `src/pilot/worktree/pool.ts`,
          `src/pilot/worktree/git.ts`, and `src/pilot/cli/worktrees.ts`
          /`resume.ts`/`retry.ts` are deleted from the tree.
  tests:
    - packages/harness-opencode/test/pilot-acceptance.test.ts::"no source file imports WorktreePool, pool.ts, or git.ts worktree helpers"
    - packages/harness-opencode/test/pilot-acceptance.test.ts::"pilot CLI subcommand tree does not include worktrees/resume/retry"
  verify: bun test test/pilot-acceptance.test.ts
  status: VERIFIED — lockdown tests walk src/**/*.ts and fail on any
          forbidden reference. Both tests pass.

- [x] id: a10
  intent: `bun run build`, `bun run typecheck`, and `bun test` all
          pass on the new tree. The skills bundle test still passes
          with 9 pilot-planning rules (10 files total including SKILL.md).
  tests:
    - packages/harness-opencode/test/skills-bundle.test.ts::"pilot-planning has SKILL.md + 9 rules (10 files total)"
    - packages/harness-opencode/test/prompts-no-dangling-paths.test.ts (whole-file)
  verify: bun run build && bun run typecheck && bun test
  status: VERIFIED — 968 tests pass, 0 fail. Build clean. Typecheck clean.
          Skills bundle asserts 9 rules + SKILL.md = 10 files.
```

## File-level changes

### packages/harness-opencode/src/pilot/worker/worker.ts
- Change: Rewrite. Drop `pool.acquire()` / `pool.prepare()` / `preserveOnFailure` / `setupCompleted` / `retryCounter` / `buildPilotEnv` / the entire setup-run block / the cascade-fail-on-setup sweep. Session creation uses `process.cwd()` as `directory`. Capture `sinceSha` via an inlined `execFile('git', ['rev-parse', 'HEAD'])` at task start. On verify fail OR touches violation that exhausts retries OR stall OR session-error OR commit failure, the worker sets a run-level `halted` flag and `runWorker` returns; it does NOT continue to later tasks. Commit path uses the inlined `commitAll` (below) in cwd, no branch switching. Remove the `pool` field from `WorkerDeps`. Remove the `setupAborted` plumbing. Add a `cwd?: string` seam (defaults to `process.cwd()`) for testability. Add a pre-flight `await checkCwdSafety(cwd)` at the top of `runWorker` that returns `{aborted: true, attempted: []}` after logging a clear refusal if the gate fails. Also remove the `headSha` re-export guard at the bottom of the file (`void headSha`) since the import goes away.
- Why: This file is the architectural hinge of the rollback.
- Risk: high

### packages/harness-opencode/src/pilot/worker/safety-gate.ts (NEW)
- Change: Add `checkCwdSafety(cwd: string): Promise<{ok: true} | {ok: false; reason: string}>`. Three checks sequentially (fail-fast, error messages name the specific violation): (1) `git rev-parse --is-inside-work-tree` must succeed and print `true`; (2) current branch via `git rev-parse --abbrev-ref HEAD` is not `main`/`master`, and — belt-and-suspenders — is not the remote's default branch per `git symbolic-ref --short refs/remotes/origin/HEAD` (tolerates absence of origin/HEAD as "not pinnable, skip that check"); (3) `git status --porcelain` is empty (this includes untracked non-gitignored files by default, which is what we want). Uses `execFile` not `exec`, 10s timeouts, null-byte rejection on inputs. Exports a tiny `headSha(cwd)` helper that the worker re-uses (satisfies open question 1 — single module keeps the git-plumbing surface minimal).
- Why: Isolate the safety-gate + the one git helper the worker still needs, so `src/pilot/worktree/` can go away entirely.
- Risk: medium — security-adjacent; see acceptance criteria a1/a2 for the honest tmp-repo tests that exercise it.

### packages/harness-opencode/src/pilot/plan/schema.ts
- Change: Remove the `setup: z.array(VerifyCommandSchema).default([])` field from `PlanSchema`. Because `PlanSchema` is `.strict()`, `setup:` keys now fail with the built-in "Unrecognized key: setup" message. Add a top-level `.superRefine()` on `PlanSchema` that specifically detects a raw-object `setup` key on the pre-validation input and emits a custom issue (`path: ["setup"], message: "The 'setup:' field was removed in the cwd-mode rollback. Run setup commands manually before 'pilot build'."`). Preserves the precise "setup" error shape for users while leaving generic strict-mode catching everything else. Remove the JSDoc paragraph about `setup:` and `setup-authoring.md` from the `PlanSchema` doc comment.
- Why: Hard-reject plans that assume the old shape, with a message that redirects the user instead of confusing them.
- Risk: low

### packages/harness-opencode/src/pilot/worktree/pool.ts
- Change: DELETE file.
- Why: Dead code; no pool in cwd mode.
- Risk: low

### packages/harness-opencode/src/pilot/worktree/git.ts
- Change: DELETE file. `commitAll`, `headSha`, `diffNamesSince`, and `currentBranch` all move. `headSha` is inlined as a 4-line helper in `safety-gate.ts` (exported). `commitAll` is inlined as a private helper in `worker.ts` — runs in cwd, uses `git add -A && git commit -m <msg>`, no branch-switching, returns new HEAD sha. `diffNamesSince` is inlined into `src/pilot/verify/touches.ts` (it's `touches.ts`'s only consumer) as a private helper that operates on cwd. `currentBranch` and the remaining git functions (`gitWorktreeAdd`, `gitWorktreeRemove`, `gitWorktreeList`, `checkoutFreshBranch`, `cleanWorktree`, `gitIsAvailable`) are deleted with no replacement.
- Why: The whole worktree surface goes away. Only the handful of useful primitives survive, inlined into the modules that need them.
- Risk: medium — the `execFileP` helper (null-byte guard, 30s default timeout, 16MB buffer) must be re-implemented or moved alongside the inlined functions. Plan: duplicate the `execFileP` shape as a private helper inside each receiving module (safety-gate.ts, worker.ts, touches.ts). Keeps each file self-contained; total duplicated code is <50 lines.

### packages/harness-opencode/src/pilot/worktree/ (directory)
- Change: DELETE directory after both files are removed.
- Why: Empty dir cleanup.
- Risk: none

### packages/harness-opencode/src/pilot/verify/touches.ts
- Change: Replace the `import { diffNamesSince } from "../worktree/git.js";` with an inlined private `diffNamesSince(cwd, sinceSha)` helper that runs the same 4-way union (`git diff <sinceSha>..HEAD` + `git diff --cached` + `git diff` + `git ls-files --others --exclude-standard`). Rename the `enforceTouches` arg from `worktree: string` to `cwd: string` for clarity; callers (worker.ts) pass `process.cwd()`. No behavior change in `enforceTouchesPure`.
- Why: `touches.ts` is the only consumer of `diffNamesSince`; inlining lets `worktree/git.ts` go away.
- Risk: low

### packages/harness-opencode/src/pilot/paths.ts
- Change: Delete `getWorktreeDir` and the `padWorker` helper (its only consumer). Keep `resolveBaseDir`, `getPilotDir`, `getPlansDir`, `getRunDir`, `getStateDbPath`, `getWorkerJsonlPath`, `getTaskJsonlPath`, `isSafeRunId`, `isSafeTaskId`. Update the module-level JSDoc header to drop the `worktrees/<runId>/<n>/` line from the layout diagram and the `getWorktreeDir` reference in the auto-creation policy note.
- Why: Run state (DB, logs, frozen plans) still lives under per-repo pilot dir; only worktree paths go away.
- Risk: low

### packages/harness-opencode/src/pilot/cli/worktrees.ts
- Change: DELETE file.
- Why: No worktree pool, no verb to inspect one.
- Risk: low

### packages/harness-opencode/src/pilot/cli/resume.ts
- Change: DELETE file.
- Why: cwd-mode resume is a future feature with different semantics (skip completed tasks, verify cwd is still on the same branch, re-run remaining). Out-of-scope per the user's "out of scope" list; per open-question 3 lean (a) delete now rather than adapt poorly.
- Risk: low

### packages/harness-opencode/src/pilot/cli/retry.ts
- Change: DELETE file.
- Why: Same rationale as resume.ts. Future-work.
- Risk: low

### packages/harness-opencode/src/pilot/cli/index.ts
- Change: Drop the `resumeCmd`, `retryCmd`, `worktreesCmd` imports and subcommand-map entries. The subcommand tree becomes: `validate`, `plan`, `build`, `status`, `logs`, `cost`, `plan-dir` (7 verbs, down from 10). Update the module JSDoc listing.
- Why: Remove deleted verbs from the CLI surface.
- Risk: low

### packages/harness-opencode/src/pilot/cli/build.ts
- Change: Drop imports of `WorktreePool`, `getWorktreeDir`, `headSha` (the pool's version). Drop the `pool` construction, the pool-shutdown cleanup entry, and the pool teardown. Drop the `deriveBranchPrefix` helper and the `branchPrefix` computation (no per-run branch namespace — commits land on the user's branch). Replace `const base = await headSha(cwd)` with `const base = "HEAD"` or drop it entirely — `sinceSha` is now captured per-task inside the worker at task start, not passed down as `base`. Drop the `base` and `branchPrefix` args from `executeRun`'s signature and from the `runWorker` call. Keep the streaming-logger and the run-row insert. In `runWorker` call site, stop passing `pool` / `base` / `branchPrefix`. The `pilot resume` call path in this file (the shared `executeRun`) now supports only fresh runs — trim the exported shape accordingly (it's still shared internally between `build.ts` and a future resume, but for now `build.ts` is the only caller).
- Why: Wire the new worker shape; remove all pool/branch plumbing.
- Risk: medium — this file is the main integration seam.

### packages/harness-opencode/src/skills/pilot-planning/rules/setup-authoring.md
- Change: DELETE file.
- Why: The planner never authors a `setup:` block anymore (the field is gone).
- Risk: low

### packages/harness-opencode/src/skills/pilot-planning/SKILL.md
- Change: Remove rule 9 (`setup-authoring.md`). Renumber current rule 10 (`qa-expectations.md`) to rule 9. Update the "Apply these ten rules" lead sentence to "Apply these nine rules". Update the "After applying the rules" section to mention setup is now the operator's responsibility: insert a single line before the "Save the YAML" step: "Remind the user the plan assumes their dev stack is already running (install, compose, migrate, seed). Plans no longer bootstrap their own environment." Keep the "When to bundle vs split" section as-is — bundling is still first-class.
- Why: The rulebook loses one rule; the planner's mental model shifts from "design setup" to "assume setup exists".
- Risk: low

### packages/harness-opencode/src/agents/prompts/pilot-planner.md
- Change: (1) Remove the rule-9 `setup:` bullet in "Apply the planning methodology". Renumber current rule 10 → rule 9 (QA-expectations). Update the "Rules 9 and 10 typically involve ONE bundled question" line to "Rule 9 typically involves ONE bundled question for QA verify patterns". (2) In Section 2 "Read the codebase", remove the `setup:`-block proposal sentence from the tooling-footprint bullet (keep "lockfiles, docker-compose services, migration tooling, UI/API/DB test frameworks" as codebase-understanding context; drop "You'll use these in Section 3 to propose a `setup:` block"). (3) In the YAML example, remove the entire `setup:` block and its three example commands. Keep `defaults:`, `milestones:`, `tasks:`.
- Why: The planner no longer writes setup blocks.
- Risk: low

### packages/harness-opencode/src/agents/prompts/pilot-builder.md
- Change: Remove the "If the plan declared a `setup:` block, treat that block as the canonical list" sentence in rule 4 (currently around line 83). Keep the rest of rule 4 (recognize canonical bootstrap commands during the fix loop) — the builder may still self-heal from "missing node_modules" during a task's fix loop, that's orthogonal. The nuance: now the builder is running in the user's actual checkout, so "missing node_modules" is a real problem worth fixing in-loop, not an isolation-induced mirage.
- Why: Remove the sentence referring to a plan field that no longer exists.
- Risk: low

### packages/harness-opencode/src/pilot/AGENTS.md
- Change: Rewrite. The "pilot decomposes a feature into a pilot.yaml DAG, then executes tasks … coordinated by a worker loop that manages git worktrees, opencode sessions, and a SQLite state store" opener loses the "manages git worktrees" clause. Layout diagram: remove `worktree/` subdir. Per-repo state layout: remove the `worktrees/` line. Invariants: drop #4 ("State DB and worktrees are per-repo"); add a new invariant: "Pilot runs in the user's current worktree (cwd). Pre-flight refuses to run on main/master/default-branch or with a dirty tree. Tasks that fail halt the run; the user recovers manually. There is no worktree pool, no setup phase, no per-task branch." CLI surface table: drop `resume`, `retry`, `worktrees` rows. Renumber as needed.
- Why: The drill-down must reflect the new architecture.
- Risk: low — documentation, but load-bearing for future agents.

### packages/harness-opencode/AGENTS.md
- Change: Rule 10's sentence "The pilot subsystem's PERSISTENT state — SQLite DB, git worktrees, JSONL logs, YAML plans — lives under `~/.glorious/opencode/<repo>/pilot/`" drops "git worktrees". Layout section: remove the `worktree/` entry from the pilot subsystem's subdirectory list. No other edits here.
- Why: Root per-dir guide must not advertise a deleted subdirectory.
- Risk: low

### .changeset/pilot-cwd-mode-rollback.md (NEW)
- Change: Create with MAJOR bump. Title: "pilot: scorched-earth rollback of worktree isolation — cwd mode is the only execution shape". Body describes the user-visible shift: (a) `pilot build` now runs in cwd; (b) plans with `setup:` fail validation; (c) the `resume`, `retry`, `worktrees` subcommands are removed; (d) the safety gate refuses on main/master/default branch and on dirty trees; (e) guidance to restore environment manually before invoking pilot. Brief enough to fit the Version Packages PR's autogenerated changelog.
- Why: Communicates the breaking change on publish.
- Risk: low

### packages/harness-opencode/test/pilot-worktree-pool.test.ts
- Change: DELETE file.
- Why: Pool is gone.
- Risk: none

### packages/harness-opencode/test/pilot-worktree-git.test.ts
- Change: DELETE file. A small successor covering the inlined `execFileP`-equivalent in `safety-gate.ts` is acceptable but not required (the safety-gate tests cover the relevant surface honestly).
- Why: Worktree git module is gone.
- Risk: none

### packages/harness-opencode/test/pilot-safety-gate.test.ts (NEW)
- Change: Unit tests for `checkCwdSafety`: real tmp git repos (bun `node:fs` + `execFile` + `node:os.tmpdir()`), one per scenario — branch=feature/X clean → ok; branch=main → reject naming "main"; branch=master → reject naming "master"; branch=feature/X with origin/HEAD set to refs/remotes/origin/develop and current branch=develop → reject; non-git directory → reject; dirty tracked change → reject; untracked non-ignored file → reject; untracked file that IS gitignored → ok. Each test creates the repo, sets up the exact scenario, calls `checkCwdSafety(tmpPath)`, asserts outcome, cleans up.
- Why: Safety gate is the load-bearing new code; it's small and honest testability matters.
- Risk: low

### packages/harness-opencode/test/pilot-worker.test.ts
- Change: Rewrite. (1) DELETE the entire `describe("runWorker — setup commands", …)` block (~10 tests). (2) DELETE the 5 env-injection tests added by the `pilot-worktree-isolation-env` changeset (they cover `buildPilotEnv`, which is gone). (3) UPDATE existing tests that refer to `prepared.path` / `slot` / `pool` / `preserveOnFailure` to use the cwd seam instead — every test that currently sets up a fake pool should now set up a cwd-scoped tmp git repo and pass a `cwd` into `runWorker` deps. (4) ADD tests named to match the acceptance criteria above: `"runWorker aborts when cwd is on main before any task runs"`, `"runWorker aborts when working tree is dirty"`, `"runWorker creates session with cwd as directory, not an isolated worktree"`, `"runWorker does not populate the pilot/worktrees directory"`, `"runVerify receives process.env with no PILOT_* keys"`, `"runVerify preserves user COMPOSE_PROJECT_NAME when set"`, `"task success commits on the current feature branch, HEAD advances"`, `"task success does not switch branches"`, `"task failure halts the run immediately; later tasks are not attempted"`, `"task failure preserves uncommitted agent edits in cwd"`, `"touches enforcement diffs against cwd HEAD captured at task start and catches out-of-scope edits"`, `"touches enforcement passes when all edits are in-scope"`. Remove the `pool: WorktreePool` field from the fixture factory and the fake-pool mocks.
- Why: The worker's shape changed; its test suite must reflect that. Test names are named exactly as the acceptance-criteria `tests:` lines require so `qa-reviewer` can execute them.
- Risk: medium — largest test-file rewrite in the change; risk of missing a mocked surface is real. Mitigate by running the file in isolation after the worker rewrite, iterating on failures.

### packages/harness-opencode/test/pilot-plan-schema.test.ts
- Change: UPDATE the `"parsePlan — setup field"` describe block. Tests that previously asserted `setup` is accepted with default `[]` / a list of commands → assert it's now REJECTED with `path: ["setup"]` and a message containing `"no longer supported"` (or the exact string; picked once the `.superRefine()` lands). Keep the multi-error-collection behavior test but change the expected field. Remove the test at ~line 670 that asserts the schema JSDoc mentions `PILOT_` and `setup-authoring.md` (the JSDoc no longer does).
- Why: Semantics flipped.
- Risk: low

### packages/harness-opencode/test/pilot-plan-load.test.ts
- Change: Remove the assertion that `setup:` defaults to `[]` on a minimal plan. If the file has a test specifically for loading a plan WITH `setup:`, flip it to expect a schema-rejection result.
- Why: The field is gone.
- Risk: low

### packages/harness-opencode/test/pilot-cli-validate.test.ts
- Change: ADD a test `"pilot validate rejects a plan with setup: and exits 2"` that creates a tmp plan file with a `setup:` block, runs `runValidate`, asserts exit 2 and the stderr mentions `"setup"`. Remove any existing test that validates a plan with `setup:` and expects exit 0.
- Why: Validates the new rejection contract end-to-end at the CLI layer.
- Risk: low

### packages/harness-opencode/test/pilot-cli-build.test.ts
- Change: AUDIT. Any test that previously mocked a worktree pool or asserted worktree-path side effects needs updating. Likely includes: tests that assert `pool.shutdown` is called (drop), tests that inspect `worktrees/<runId>/00` (drop), tests that assert branch naming (simplify — no per-run prefix). Replace with tests that assert the build runs inside a tmp git repo on a feature branch, commits land on HEAD, and no `worktrees/` dir is created. Length of the audit depends on how entangled the existing tests are; budget ~30–60 min.
- Why: CLI-level integration has moved.
- Risk: medium

### packages/harness-opencode/test/pilot-cli-admin.test.ts
- Change: AUDIT. Remove any tests of the deleted `worktrees`, `resume`, `retry` verbs. Keep tests of `status`, `logs`, `cost`.
- Why: Those verbs are gone.
- Risk: low

### packages/harness-opencode/test/skills-bundle.test.ts
- Change: (1) Bump the `pilot-planning` count assertion from `11 files` to `10 files` and from `10 rules` to `9 rules`. (2) Remove `"setup-authoring.md"` from the sorted rules array. (3) DELETE the `"setup-authoring.md documents PILOT_* injected env vars"` test. (4) Review the `"decomposition.md documents plan-level sizing and multi-issue bundling"` test — if it references `setup-authoring.md` cross-links, remove that substring check; the other checks (Plan sizing, multi-issue, Disconnected) stay.
- Why: One file gone; bundle shape smaller.
- Risk: low

### packages/harness-opencode/test/agents.test.ts
- Change: Remove any planner-prompt content assertions that match on the `setup:` YAML example, the rule-9 bullet referencing `setup-authoring.md`, or the Section 2 "propose a setup block" clause. Keep the count, permission, and general-structure assertions.
- Why: The planner prompt's content changed.
- Risk: low

### packages/harness-opencode/test/pilot-acceptance.test.ts
- Change: ADD two assertions: (1) `ripgrep`-equivalent search that `WorktreePool`, `pool.ts`, or `getWorktreeDir` do not appear in any `src/**/*.ts` file; (2) the CLI subcommand tree exported from `src/pilot/cli/index.ts` does not include `worktrees`, `resume`, or `retry`. Keep existing assertions.
- Why: Lock in the "truly deleted" invariant so future commits don't silently re-introduce the pool.
- Risk: low

## Test plan

**Unit, per-module:**

- `test/pilot-safety-gate.test.ts` (NEW) — 8 scenarios per a1/a2.
- `test/pilot-worker.test.ts` — rewrite per above; every a3/a4/a5/a6/a8 test is named to match its acceptance row.
- `test/pilot-plan-schema.test.ts` — setup-rejection (a7).
- `test/pilot-cli-validate.test.ts` — setup-rejection at CLI level (a7).
- `test/skills-bundle.test.ts` — bundle shape (a10).
- `test/pilot-acceptance.test.ts` — deletion lockdowns (a9).

**Integration:**

- `test/pilot-cli-build.test.ts` — end-to-end `pilot build` in a tmp git repo on a feature branch; assert commit lands on HEAD, no worktrees dir, stdout summary.
- `test/pilot-cli-admin.test.ts` — unaffected verbs still work.

**Full suite:**

- `bun run build && bun run typecheck && bun test` green.
- `test/prompts-no-dangling-paths.test.ts` green (we're not touching paths that would introduce `~/.claude` or similar, but a grep-audit on the diff is a good idea).

**Manual verification (post-PR, pre-merge):**

- Fresh checkout of kn-eng on a feature branch with a running local dev stack: run `bunx pilot build <real-plan.yaml>`, confirm a task succeeds and commits appear on the branch, confirm no `~/.glorious/opencode/kn-eng/pilot/worktrees/` entries.
- Attempt `pilot build` on main: confirm refusal with clear message.
- Attempt `pilot build` with an untracked file: confirm refusal.
- Feed a plan with `setup:`: confirm `pilot validate` exits 2 with a specific message.

## Out of scope

- Reintroducing isolation via a `--isolate` flag later. Future-work.
- Parallel workers. Pre-existing deferral; unaffected.
- Preserving the isolation code path under a legacy switch. Full gut.
- Schema migration for `setup:` (e.g., auto-strip with a warning). REMOVED is removed.
- Docs-site content rewrite (`docs/` package). Follow-up in a separate PR.
- `pilot resume` and `pilot retry` reimplementation for cwd mode. Separate feature; likely different UX anyway ("skip succeeded tasks, re-run remaining on current branch").
- Renaming `/pilot/worktrees/` on disk or cleaning up existing preserved worktrees from pre-rollback runs. User's housekeeping.
- Auto-stashing or auto-committing the user's dirty tree before running. The gate REFUSES on dirty; it does not try to be clever.
- Updating the `cli.ts`-level top-level help text beyond removing the deleted verbs. Auto-handled by cmd-ts.

## Open questions

All 11 open questions from the brief are resolved in the plan above; leanings adopted:

1. **`headSha` fate** — inlined into `safety-gate.ts` (4-line helper, exported). Worker imports from there. No separate `git-helpers.ts`.
2. **`cli/worktrees.ts` fate** — DELETED, removed from the CLI registration.
3. **`cli/resume.ts` and `cli/retry.ts` fate** — DELETED. cwd-mode resume/retry is a follow-up feature with different semantics.
4. **`paths.ts` worktree functions** — `getWorktreeDir` DELETED along with the `padWorker` helper; other path resolvers (run dir, state DB, JSONL, task JSONL) stay.
5. **Safety-gate dirty-tree strictness** — HARD REJECT on any uncommitted tracked change OR any non-gitignored untracked file. `.gitignored` files are allowed. Matches `/fresh --yes`.
6. **Default-branch detection** — BOTH literal `main`/`master` AND `git symbolic-ref refs/remotes/origin/HEAD` (when the ref exists). Belt-and-suspenders protects users on non-main default branches.
7. **Previous in-flight changesets** — KEEP. They describe commits that landed. The new MAJOR changeset on top describes the rollback. Version Packages PR coalesces at release time.
8. **Touches-scope enforcement in cwd mode** — `sinceSha` captured via `git rev-parse HEAD` in cwd at task start, post-agent enforce against the union of `git diff <sinceSha>..HEAD` + `git diff --cached` + `git diff` + `git ls-files --others --exclude-standard`. Same 4-way union as pre-rollback, just rooted in cwd.
9. **Commit mechanics** — `git add -A && git commit -m "<task-id>: <title>"` in cwd. NO branch switching. HEAD advances on the user's current branch. Commit subject unchanged from pre-rollback.
10. **Pre-flight timing** — ONCE at `runWorker` top, before any task picks. After task 1 commits, HEAD has moved but that's fine — no re-check.
11. **Docs update scope** — `src/pilot/AGENTS.md` and the root `packages/harness-opencode/AGENTS.md` only. README and docs-site in a follow-up PR (out of scope above).

### Existing debt to consider

None found by `comment_check` on `src/pilot/` — no `@TODO`/`@FIXME`/`@HACK`/`@XXX`/`@DEPRECATED` annotations older than 30 days are present in the directories this plan touches. The subsystem is clean of stale markers.
