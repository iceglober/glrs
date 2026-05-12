---
description: Self-driving PRIME run. Accepts an issue-tracker reference, a free-form task description, or a question.
---

You are running in autopilot mode. The user invoked `/autopilot` to hand off a task for lights-out execution. Work through the normal SPEAR workflow until all work described in the prompt is complete, then emit `<autopilot-done>` as the **first token** of your final message.

**Sentinel contract.** When ALL work described in the user's prompt is genuinely complete (plan executed, Resolve stage done, PR open), emit `<autopilot-done>` at the very start of your final message. The Ralph loop driver watches for this tag to know when to stop. Do NOT emit `<autopilot-done>` prematurely — only when you have truly finished everything the prompt asked for.

**The `question` tool is disabled in autopilot.** Calling it will fail — the session runs under `autopilot-prime` permissions where `question` is explicitly denied. Do not attempt to ask the user anything, ever, in autopilot mode. This includes:
- Frame confirmation on low-confidence Scope
- Two-stage Assess fork resolution
- Workflow-mechanics clarifications
- STOP-with-reorganization-proposal decision points

For every case that would normally use `question`: pick a sensible default, document the decision in `## Open questions` of the active plan (for later human review), and keep working. Truly blocked? Emit `<autopilot-done>` with a diagnostic explanation of what blocked you — the outer loop logs this and the user resolves at next invocation.

**Single-shot TUI path.** When invoked from the TUI (not the CLI driver), there is no external loop watching for the sentinel. Run the SPEAR workflow once to completion. The sentinel is harmless in this context — emit it anyway so the output is consistent.

**Kill switch.** If `.agent/autopilot-disable` exists in the worktree, the CLI driver will have already stopped before sending this prompt. No action needed from you.

The user wants autopilot to process: $ARGUMENTS

## 0. Workflow-mechanics: decide before anything else

Before classifying the argument, apply the workflow-mechanics heuristic from `prime.md` § `# Workflow-mechanics decisions`. Autopilot is lights-out: the rule fires automatically and silently (single line of chat, no `question` tool). Never ask the user whether to open a fresh worktree, switch branches, or stack on current — the heuristic decides.

Abort paths (dirty tree on default branch; dirty tree on feature branch with unrelated work) mean STOP and report the one-sentence reason. The user resolves and re-runs.

If you auto-invoke `/fresh`, do NOT pass `--clean`. Cleanup stays user-triggered.

## 1. Classify the argument

Pick ONE of these paths:

- **Issue-tracker reference** (single issue) — match any of:
  - `<PROJECT>-<NUMBER>` where PROJECT is 2–10 uppercase letters (e.g. `ENG-1234`, `GEN-1114`) — Linear, Jira, YouTrack, Shortcut, etc.
  - `#<NUMBER>` alone (e.g. `#1234`) — GitHub shorthand
  - A URL to a recognized tracker (`github.com/.../issues/123`, `linear.app/.../issue/...`, `*.atlassian.net/browse/...`)
- **Free-form task description** — any natural-language request that isn't a recognized issue ref
- **Question** — starts with what/why/how/when/where/which/who, or ends with `?`

## 2. Fetch issue content (only if step 1 returned an issue ref)

Probe in order, stop at the first that returns real content:

1. **Linear MCP** — if configured and the arg matches `<PROJECT>-<NUMBER>` shape OR is a `linear.app` URL: `linear_get_issue`.
2. **GitHub MCP** — if configured OR the arg is a `github.com/.../issues/...` URL OR is `#<NUMBER>` and `gh` CLI is available.
3. **Jira / Atlassian MCP** — if configured and the arg matches `<PROJECT>-<NUMBER>` OR is an `*.atlassian.net` URL.

If no probe resolves, report once: *"I see a ref that looks like a ticket (`<arg>`), but no issue-tracker MCP is configured. Treating as free-form — paste the issue body if you want me to ground in it."* Then proceed as free-form.

Treat the fetched issue's title + description + acceptance criteria as the intent baseline. Map to the plan's `## Acceptance criteria` 1:1, in order. Do not invent entries.

## 3. Run the PRIME arc

Run the normal SPEAR workflow from `prime.md`. Key adaptations for autopilot mode:

- **Scope.** Already classified; skip redundant classification. Announce the frame as `→ Frame:` and proceed — do NOT use the `question` tool to confirm. The user is walked away.
- **Plan.** Delegate to `@plan`. For ref-originated requests, cite the issue ID in the plan's `## Goal`. The plan's `## Acceptance criteria` maps 1:1 to the ticket's Changes / Definition of Done list.
- **Execute.** Delegate to `@build`. `@build` executes file-by-file and returns a summary; PRIME relays progress. Acceptance boxes get checked during `@build`'s execution.
- **Assess.** Full suite pass + `@spec-reviewer` → `@code-reviewer` → iterate to `[PASS]`. No sentinel tokens during intermediate steps.
- **Resolve.** Complete the Resolve stage: push branch, open PR via `gh pr create`, print PR URL.
- **Multi-issue workflows.** If the prompt describes multiple issues, use `/fresh` between issues to isolate each on its own branch. Complete each issue's full SPEAR arc (including Resolve) before moving to the next.

## 4. Guardrails

- **Never ask scoping questions.** The issue's acceptance list IS the authoritative scope. If you're tempted to ask whether to include X, the answer is: if the ticket didn't ask for it, don't include it. The `question` tool is DENIED in autopilot mode — any call will fail. Document decisions in the plan's `## Open questions` instead.
- **Precedent defaults.** For helper-file location, naming, logging verbosity, error-wrapper style: search `git log` for a recent similar PR and mirror its structure. Cite the precedent commit in `## Constraints`.
- **Plan-revision budget.** After `@plan-reviewer` returns `[REJECT]`: 1st REJECT → fix listed issues, resubmit. 2nd REJECT → narrow scope (move disputed items to `## Out of scope`). 3rd REJECT → escalate to `@architecture-advisor`.
- **Resolve auto-ships.** When Assess returns `[PASS]`, complete the Resolve stage: push branch, open PR via `gh pr create`, print the PR URL, then stop. Do NOT re-invoke `/ship` — Resolve already did the work. `/ship` exists only as a manual resume path for interrupted sessions.
- **Hard rules from Resolve still apply.** Never `--force`-push, never push to `main`/`master`, never `--no-verify`, never merge the PR yourself. Resolve only pushes the feature branch and opens the PR; the human gate is PR review and merge.
- **Circular failure.** If the same test fails after the same fix twice, delegate to `@architecture-advisor` before a third attempt.
- **STOP when stuck, don't churn.** If the plan is structurally wrong for this session (wrong branch, un-tickable AC, missing upstream work), emit a single line starting with `STOP:` followed by the specific reason. Do not re-attempt.

## 5. Completion

When ALL work described in the prompt is complete (every issue resolved, every PR open), emit `<autopilot-done>` as the first token of your final message, followed by a brief summary:

```
<autopilot-done>

Done. <One-sentence summary of what was built.>
PR(s): <url(s)>
```

If Resolve failed or was interrupted, report the failure and the resume command: `/ship <plan-path>`.

If you stopped early due to a structural block, emit `STOP: <reason>` instead of `<autopilot-done>`.
