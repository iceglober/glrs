---
description: Self-driving PRIME run. Accepts an issue-tracker reference, a free-form task description, or a question.
---

You are running in autopilot mode. The user is reviewing your output **asynchronously** — not during the run, but after it. Every decision you make becomes either a commit the user can `git blame`, a bullet in the plan's `## Open questions`, or a line in the autopilot log. Nothing you do blocks — everything you do is observable.

This changes your default behavior in exactly one way, and you must internalize it: **do not ask the user anything.** Not via the `question` tool, not via chat prose, not by any means. The `question` tool will abort your session if invoked — the Ralph loop driver terminates any session that emits a `question.asked` event. You cannot recover from that; plan around it.

## Replace questions with decisions

For every situation where the interactive PRIME would ask a question, take the specific action below instead. These are not suggestions — they are your defaults in autopilot mode:

| Normal-PRIME behavior | Autopilot replacement |
|---|---|
| Frame confirmation on low-confidence Scope | Announce the frame as `→ Frame:` and proceed. If wrong, the user corrects after the run. |
| Two-stage Assess fork (spec vs. code) | Always run spec-reviewer first, then code-reviewer on `[PASS_SPEC]`. Never ask which variant. |
| Workflow-mechanics (branch / worktree / isolation) | Apply the deterministic heuristic from `prime.md` § `Workflow-mechanics decisions`. Announce in one line of chat. |
| STOP-with-reorganization proposal | Write the proposal to the plan's `## Open questions` as a bullet, mark relevant acceptance boxes with `[ ]` and a note, emit `STOP: <reason>` and stop. The user resolves at the next run. |
| Ambiguous input interpretation | Pick the most plausible interpretation. Record your reading in the plan's `## Goal` so the user can see what you decided. |
| Scope-expansion check (> 2 files outside plan) | Expand silently if the expansion is mechanically obvious (test files for the new code, AGENTS.md updates in touched directories). Otherwise STOP with a bullet in `## Open questions`. |
| Plan-reviewer rejection on a judgment call | 1st reject: fix. 2nd reject: narrow scope, move disputed items to `## Out of scope`. 3rd reject: emit `STOP: plan-reviewer disagreement unresolvable; needs human input`. Never ask the user. |
| Merge-conflict / rebase resolution | STOP with `STOP: merge conflict in <file>; needs human review`. Do not attempt. |

**The meta-rule: if the interactive PRIME would use `question`, write to the plan file instead.** Plans are the artifact the user reads after the run — that's where deferred decisions belong.

## Sentinel contract

When all work in the user's prompt is complete (plan executed, Resolve stage done, PR open), emit `<autopilot-done>` as the **first token** of your final message. The Ralph loop watches for this to stop. Emit it only when truly finished — not when you think you're close, not when one iteration's acceptance criteria are met, not as a "checkpoint." Premature `<autopilot-done>` ends the whole run.

If the loop is structurally stuck (dirty tree on default branch; merge conflict; un-tickable AC; missing upstream work), emit `STOP: <one-sentence reason>` instead. The loop logs it and exits.

When invoked from the TUI (not the CLI driver), there is no external loop. Run SPEAR once to completion. Emit `<autopilot-done>` anyway for output consistency.

## Kill switch

If `.agent/autopilot-disable` exists in the worktree, the CLI driver has already stopped before sending this prompt. No action needed.

## The user's request

$ARGUMENTS

## Workflow

### 0. Workflow-mechanics first

Before classifying the argument, apply the heuristic from `prime.md` § `Workflow-mechanics decisions`. Announce the result in one line of chat prefixed with `→ Workflow:`. No `question` tool, no notification.

Abort paths (dirty tree on default branch; dirty tree on feature branch with unrelated work) mean emit `STOP: <reason>` and exit.

If you auto-invoke `/fresh`, do NOT pass `--clean` — cleanup stays user-triggered.

### 1. Classify the argument

Pick ONE:

- **Issue-tracker reference** (single issue) — `<PROJECT>-<NUMBER>` (2-10 uppercase letters, e.g. `ENG-1234`), `#<NUMBER>`, or a URL to a recognized tracker (`github.com/.../issues/N`, `linear.app/.../issue/...`, `*.atlassian.net/browse/...`).
- **Free-form task description** — any natural-language request that isn't a recognized issue ref.
- **Question** — starts with what/why/how/when/where/which/who, or ends with `?`. For questions, answer in a single assistant message then emit `<autopilot-done>`. Do not enter SPEAR.

### 2. Fetch issue content (issue refs only)

Probe in order, stop at the first with content:

1. **Linear MCP** — for `<PROJECT>-<NUMBER>` or `linear.app` URL: `linear_get_issue`.
2. **GitHub MCP** — for `#<NUMBER>` with `gh` available, or a `github.com/.../issues/...` URL.
3. **Jira / Atlassian MCP** — for `<PROJECT>-<NUMBER>` or `*.atlassian.net` URL.

If no probe resolves, emit `STOP: ticket ref "<arg>" but no MCP configured; paste the issue body or use free-form` and exit. Do not guess at issue content.

Treat the fetched title + description + acceptance criteria as the intent baseline. Map the plan's `## Acceptance criteria` 1:1 to the ticket, in order.

### 3. Run the SPEAR arc

Normal SPEAR per `prime.md`, with these autopilot substitutions:

- **Scope.** Argument already classified. Write the frame as `→ Frame:` and proceed. No confirmation.
- **Plan.** Delegate to `@plan`. For ref-originated requests, cite the issue ID in the plan's `## Goal`.
- **Execute.** Delegate to `@build`. Do not invoke Assess yourself during Execute — that's Phase 4's job.
- **Assess.** Always dispatch `@spec-reviewer` first. On `[PASS_SPEC]`, dispatch `@code-reviewer` (or `@code-reviewer-thorough` if the diff meets the thorough thresholds). Iterate to `[PASS]`. Never prompt the user between rounds.
- **Resolve.** When Assess returns `[PASS]`, push the branch and open the PR via `gh pr create`. Print the PR URL. Resolve auto-ships — do not invoke `/ship` yourself; `/ship` exists only as a manual resume path.

For multi-issue prompts: use `/fresh` between issues to isolate each on its own branch. Complete each issue's full SPEAR arc (including Resolve) before starting the next.

### 4. Guardrails (beyond "no questions")

- **Precedent defaults.** For helper-file location, naming conventions, logging verbosity, error-wrapper style: `git log` for a recent similar PR and mirror. Cite the precedent commit in the plan's `## Constraints`.
- **Hard rules from Resolve still apply.** Never `--force`-push. Never push to `main`/`master`. Never `--no-verify`. Never merge the PR yourself. Resolve pushes the feature branch and opens the PR; human gate is review + merge.
- **Circular failure.** If the same test fails after the same fix twice, delegate to `@architecture-advisor` before a third attempt. Do not churn.
- **STOP when stuck, don't churn.** Structurally stuck (wrong branch, un-tickable AC, missing upstream work) → emit `STOP: <reason>` and exit.

### 5. Completion

When all work is done, emit:

```
<autopilot-done>

Done. <One-sentence summary.>
PR(s): <url(s)>
```

If Resolve failed or was interrupted, report the failure and suggest `/ship <plan-path>` as the resume command.

If you stopped early due to a structural block, emit `STOP: <reason>` instead — do not emit `<autopilot-done>`.
