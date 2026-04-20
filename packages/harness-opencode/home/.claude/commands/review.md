---
description: Review an existing PR, current branch, staged changes, or a commit range. Orchestrator-driven, read-only, no file edits.
---

Review target: $ARGUMENTS

You are the orchestrator. This command is **read-only** — you will NOT modify files, run tests in a way that touches the filesystem, commit, push, or edit any plan. You produce a structured review report and stop.

## 1. Resolve the target

Classify `$ARGUMENTS` silently. Do NOT ask the user to clarify which form they meant — pick the most likely and proceed.

- **Empty / missing** — review the current branch's changes: `git diff $(git merge-base HEAD origin/main)..HEAD` (all commits ahead of main) plus any uncommitted + staged changes (`git diff HEAD`).
- **Number** (e.g. `1234`) or **GitHub PR URL** (`https://github.com/.../pull/1234`) — treat as a PR. Use `gh pr view <num>` + `gh pr diff <num>` + `gh pr view <num> --json title,body,author,labels,files,baseRefName,headRefName`. If the PR's head branch is checked out locally, also include any uncommitted changes.
- **Commit SHA** (7+ hex chars) — review that single commit: `git show <sha>`.
- **Range** (`A..B` or `A...B`) — review the commit range: `git diff <range>`.
- **"staged"** — review staged changes only: `git diff --cached`.
- **"HEAD"** — review the most recent commit only: `git show HEAD`.
- **A file path** — review uncommitted + last commit touching that file: `git diff HEAD <path>` + `git log -1 -p <path>`.

If the scope is ambiguous after the classifier (rare), make the most-likely pick and state it in your report's opening line.

## 2. Gather context

- **Branch name** → if it matches `<team>/<TICKET>-<slug>` or `<team>-<NUM>`, fetch the Linear issue via the `linear` MCP for acceptance criteria + description. Use that as the "intent" baseline the diff should satisfy.
- **PR description** (if target is a PR) → that's the intent baseline.
- **No Linear issue, no PR description** → state "no stated intent captured" in the report; judge the diff on its own merits.
- **Recently modified files in the diff** → for files > 200 lines, run `comment_check` to surface existing `@TODO`/`@FIXME`/`@HACK` context.
- **Changed TS symbols** → use `serena_find_symbol` + `serena_find_referencing_symbols` on the top-3 most load-bearing symbol changes to measure blast radius. This is the single most important tool-preference for review work.

## 3. Run the review

Delegate to `@qa-reviewer` with:
- The resolved target (e.g., "PR #1234" or "current branch ahead of main")
- The intent baseline (Linear issue body + acceptance criteria, or PR description, or "no stated intent")
- A directive: "Review this as PR-style adversarial analysis — not vs a specific plan. Output structured FAIL findings (file:line + specific issue) or PASS with summary."

If `@qa-reviewer` returns `[PASS]`, accept it. If `[FAIL]`, that's your finding list.

For any finding flagged as security-sensitive or architecture-level (new service boundary, new entity, new auth path, public API shape change), also delegate to `@architecture-advisor` for a second opinion. Include its recommendation in the report.

## 4. Run automated checks inline

- `tsc_check` on the project root → type errors
- `eslint_check` on the specific files changed → lint issues
- `todo_scan` with `onlyChanged: true` against the diff — surface any TODO/FIXME/HACK that was added

Include the output of each in the report. Failures here are not auto-failures of the review (users may be WIP) but they should be surfaced.

## 5. Report

Output format:

```
# Review: <target>

## Intent
<1-2 sentences from Linear issue / PR body, or "no stated intent captured">

## Verdict
[PASS] or [FAIL] or [PASS WITH CONCERNS]

## Findings

### Must fix (blocking)
- `<file>:<line>` — <specific issue + suggested approach (not a patch)>

### Should consider (non-blocking)
- `<file>:<line>` — <concern>

### Automated checks
- tsc_check: <N errors | clean>
- eslint_check: <N issues | clean>
- todo_scan (new TODOs in diff): <list or none>

### Blast radius
- <symbol> → used in <N> places, changes are/aren't backwards-compatible

## Architecture note
<Only if @architecture-advisor was consulted. One paragraph summary.>
```

Keep findings specific and actionable. Avoid "consider adding tests" — instead, "no test covers the branch at <file>:<line> where <specific scenario>."

## Hard rules

- Read-only. NEVER commit, push, edit files, check out branches, or mutate anything.
- If the target is a PR on a different branch and you need to see the code, use `gh pr diff` — do NOT `gh pr checkout`. The user's working tree is sacred.
- One report at the end, not a running commentary.
- Prefer `serena_find_referencing_symbols` over grep when measuring blast radius on TS code.
- Do NOT ask the user clarifying questions unless the target genuinely can't be resolved. Pick the most-likely scope and state it.
