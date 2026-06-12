---
name: spear-protocol
description: Use when executing multi-step implementation requests end-to-end.
---

# SPEAR Protocol

The SPEAR protocol (Scope → Plan → Execute → Assess → Resolve) is the end-to-end workflow for substantial implementation requests. Load this skill at session start and follow the stages below.

## Bootstrap

Before Scope, run this probe inline (no subagent) — sessions typically start in whatever state a previous task left behind:

1. `pwd` — confirm working directory.
2. `git status --short` — see uncommitted work.
3. `git log --oneline -5` — recent history.
4. Resolve the plan dir and list recent plans:
   `PLAN_BASE="${GLRS_PLAN_DIR:-$HOME/.glrs/opencode}" && GIT_COMMON="$(git rev-parse --git-common-dir 2>/dev/null)" && [ -n "$GIT_COMMON" ] && [[ "$GIT_COMMON" != /* ]] && GIT_COMMON="$PWD/$GIT_COMMON"; REPO_FOLDER="$(basename "$(dirname "$GIT_COMMON")" 2>/dev/null)" && [ -n "$REPO_FOLDER" ] && [ "$REPO_FOLDER" != "." ] && ls "$PLAN_BASE/$REPO_FOLDER/plans" 2>/dev/null | tail -5` — plans for this repo.

For each plan found, read it and count unchecked acceptance items. Classify as **stale** (ignore) only if `git merge-base --is-ancestor HEAD origin/main` (fallback `origin/master`) exits 0. If classification fails, treat as active.

On a clean repo, Bootstrap output is ≤ 5 lines. If any plan is active, acknowledge it and ask via the `question` tool whether to resume, abandon, or clarify.

## Scope

Read the user's request. Classify into one of four paths:

- **Trivial** (single file, < 20 lines, no behavior change): inspect first, then act. Do NOT interview.
- **Substantial** (multi-file, multi-step, or any behavior change worth reviewing): run all SPEAR stages.
- **Question only** (user is asking, not requesting action): answer in chat, do NOT modify files.
- **Investigate/triage** (an issue/ticket reference, a support escalation, "work this ticket"): run the prior-work check below BEFORE framing any new work.

### Prior-work check (investigate/triage requests)

Tickets frequently duplicate work that already shipped. Before planning anything:

1. Search the tracker for sibling issues sharing the same source reference (source ticket id, org/customer id, page or symptom named in the title) and read their statuses.
2. If a COMPLETED issue already covers the request: the task collapses to **verify + write back** — and the evidence-gathering is DELEGATED, not done solo. Dispatch ONE bounded consult via the `task` tool to `@oracle` with: the issue ids found, the source ticket reference, and the question "what shipped that covers this request — give file paths, commit, and PR citations". When it returns, verify its citations yourself with at most 2-3 targeted reads (the shipped diff or the current code), then go straight to Resolve's no-change path. If the dispatch errors or returns nothing, retry it ONCE; if it fails again, fall back to verifying solo with the same 2-3 targeted reads — a failed consult never blocks the resolution. Do NOT run builds, typechecks, or tests for code you did not change; verification of shipped work is reading evidence, not re-validating the build.
3. Re-fetching the same issue or comments cannot produce new information — each tracker object is read AT MOST once. When you have read the issue, its comments, and the linked prior work, you have everything the tracker will give you: STOP gathering and synthesize.

### First-principles frame (substantial requests only)

Before interviewing or planning, write a first-principles framing:

- **Current state:** what the system does today
- **Desired state:** what the user wants it to do
- **Why:** optional, only if motivation isn't tautological

Score confidence. **High confidence** → print as `→ Frame:` and proceed. **Low confidence** → send via `question` tool with yes / refine / cancel options.

### Parallel grounding

When grounding in the codebase for Scope, dispatch parallel searches for independent subsystems. Use `@code-searcher` for large scans. For TypeScript symbol lookups, use Serena MCP tools FIRST (`serena_find_symbol`, `serena_get_symbols_overview`, `serena_find_referencing_symbols`).

### Scope-check for multi-subsystem requests

Before proceeding to Plan, verify the request doesn't span multiple independent subsystems that should be separate plans. If the request touches 3+ unrelated subsystems, ask the user whether to split into separate plans or proceed as one.

## Plan

For substantial work, delegate to `@plan` via the task tool. Pass:
- The user's original request (verbatim)
- The confirmed Scope frame
- Any interview answers
- A short grounding summary: real files/symbols that will change, relevant patterns, constraints

`@plan` returns the plan path. It handles gap-analysis, drafting, and `@plan-reviewer` adversarial review internally.

**Pattern gate.** When the work introduces a new concept (a new kind of entity, config surface, lifecycle, or cross-cutting mechanism) or adds another instance of an existing theme, the plan must contain a `## Pattern decisions` section (pattern-first skill): the incumbent pattern is inventoried, its sustainability tested, and a decision recorded — follow / extend / replace-now / quarantine / set. Existing code is precedent, not authority; a plan that silently propagates a pattern it identified as unsustainable fails `@plan-reviewer`.

## Execute

Dispatch `@build` subagents via the task tool.

**Parallel is the default — sequential is the exception.** When the plan has multiple phases or items with disjoint file sets, dispatch one `@build` per phase/group — all task tool calls in a SINGLE message so they run concurrently. Fall back to sequential only when all items share the same files, items have explicit ordering dependencies, or the plan has a single item. See PRIME's Execute supplements for the dispatch-mode gate.

### Structured handoff for strict executors

When `@build` is on the `mid-execute` tier, supplement the delegation prompt with:

```
Structured context (supplements the plan):

Files you may touch (ONLY these):
  - <path> (<CREATE|EDIT|DELETE>)
  ...

Verify commands (run after each file, must exit 0):
  - <exact bash command>
  ...

Non-goals (do NOT do these):
  - Do NOT modify <file/module outside scope>
  ...
```

### On `@build`'s return

1. Validate the diff matches the plan.
2. Handle STOP payloads:
   - **Cosmetic / self-imposed numeric threshold**: update the plan and re-dispatch.
   - **Approach / design change**: ask the user via `question` tool. Re-dispatch once resolved.
   - **Scope expansion beyond ~2 files**: ask the user whether to accept.
   - **STOP-with-reorganization-proposal** (pre-existing failure fix would require >~5 files outside the plan): display diagnosis + proposed reorganization to the user; if approved, update the plan and re-dispatch; if the user prefers a different resolution, follow their direction. Do NOT auto-accept.
3. Handle `DONE_WITH_CONCERNS`: review the concerns, decide whether to proceed to Assess or loop back to Plan.
4. **Handle DONE with red CI.** If `@build` returns DONE but any test/lint/typecheck is failing, treat as BLOCKED and re-dispatch with the specific failing commands.

**Root-cause diagnosis policy.** When `@build` encounters a failing test/lint/typecheck, it must run the root-cause diagnosis protocol (see `@build`'s prompt for the full rationalization table): reproduce on merge-base, run `git blame`, determine scope. Pre-existing failures still block merge — there is no deferral path.

Then proceed to Assess.

## Assess

Final verification before Resolve. Implements an explicit iterative loop.

**Red CI blocks merge.** Pre-existing claims without evidence (commit SHA + git log + merge-base reproduction) are auto-rejected by `@spec-reviewer` and `@code-reviewer`. Any red output from typecheck, test, or lint is a FAIL regardless of whether the failure appears pre-existing.

### MECE rubric (five dimensions)

Assess evaluates five dimensions — every dimension must pass for `[PASS]`:

1. **Correctness** — Does the code do what the plan says? Are acceptance criteria met?
2. **Completeness** — Are all plan items implemented? Are edge cases handled?
3. **Consistency** — Does the code follow the plan's `## Pattern decisions` (when present), then existing codebase patterns? Are naming/types consistent? Matching existing code is NOT a pass when the matched code is a pattern the plan flagged as unsustainable.
4. **Safety** — Are there security, data-loss, or deployment risks?
5. **Scope** — Does the diff stay within the plan's `## File-level changes`? No unplanned additions?

### Progressive strictness

Strictness increases across Assess iterations within a session:

- **Level 1/3 (first Assess):** Standard review. Trust-recent-green applies. Focus on correctness and scope.
- **Level 2/3 (second Assess, after FIX-INLINE loop):** Elevated scrutiny. Re-run tests unconditionally. Check all five MECE dimensions explicitly.
- **Level 3/3 (third Assess, after LOOP-TO-PLAN):** Maximum strictness. Treat as a fresh review. Escalate to `@code-reviewer-thorough` regardless of diff size.

### Two-stage delegation

Pick the reviewer variant first:

- **`@code-reviewer-thorough`** (Opus, re-runs full suite) if ANY of: diff touches >10 files, diff >500 lines, plan declares `Risk: high` on any file, OR the diff touches any security/auth/crypto/billing/migration-sensitive path, OR this is Level 3/3 strictness.
- **`@code-reviewer`** (Sonnet, fast) otherwise.

Then dispatch in sequence:

1. **Dispatch `@spec-reviewer` first.** Pass the plan path and diff context.
   - On `[PASS_SPEC]`: proceed to step 2.
   - On `[FAIL_SPEC: <summary>]`: feed the full report back to `@build` as a FIX-INLINE (if the issues are trivial) or to Plan as a LOOP-TO-PLAN (if structural). Do NOT dispatch `@code-reviewer`.

2. **Dispatch `@code-reviewer` (or `@code-reviewer-thorough`) only after `[PASS_SPEC]`.** Pass the plan path, diff context, and session-green summary from pre-Assess verification.
   - On `[PASS]`: proceed to Resolve.
   - On `[LOOP-TO-PLAN: <summary>]`: feed the full Assess report back to Plan. Plan updates its file-level changes and/or acceptance criteria, then re-enters Execute → Assess.
   - On `[FIX-INLINE: <summary>]`: fix inline and re-delegate to `@spec-reviewer` → `@code-reviewer`. Increment strictness level.

### Session-green summary

Always include when delegating to `@code-reviewer`. Run the repo's test, lint, and typecheck commands between Execute and Assess (see PRIME's pre-Assess verification supplement). Include in the delegation prompt:

```
tests passed at <ISO-8601 timestamp>
lint passed at <ISO-8601 timestamp>
typecheck passed at <ISO-8601 timestamp>
```

Include only lines that actually passed. Do not fabricate.

### Loop limits

- Maximum 3 Assess → Plan loops per session. After 3 loops, escalate to user with a summary of what's still failing.
- No limit on FIX-INLINE iterations.
- Each loop iteration passes the Assess report (full text) as context to Plan.

## Resolve

**No-change resolutions.** When the work produced ZERO code changes (already-resolved/duplicate, answer-only, or pure triage), the ship steps below DO NOT APPLY — there is nothing to commit, push, typecheck, or open a PR for. Resolution is a single final message containing: (a) what resolved the request, with issue/PR/commit references; (b) the verification evidence you read; (c) the exact write-back comment text you would post to the tracker; (d) the proposed status change (e.g. "close as duplicate of X"). If tracker mutations are unavailable, that proposal itself completes the task — state it and stop.

After Assess returns `[PASS]` on changed code, auto-ship the work:

1. **Survey working state** — run `git status --short`, `git log --oneline origin/$(git rev-parse --abbrev-ref HEAD)..HEAD 2>/dev/null || git log $(git merge-base HEAD origin/main)..HEAD --oneline`, and `git diff --stat` in parallel.
2. **Commit / squash** — derive a commit message from the plan title + goal. Squash all local commits into one if multiple exist. Format: `<type>: <title>\n\n<one paragraph summarizing what and why>\n\nPlan: <plan-path>`.
3. **Push** — `git push -u origin "$BRANCH"`. Never to `main` or `master` directly. On non-fast-forward or hook failure → STOP and report to user.
4. **Open PR** — `gh pr create --title "<subject>" --body "$(cat <plan-path-or-tempfile>)"`. Use the plan contents as the PR body.
5. **Print PR URL** as final output.
