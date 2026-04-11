export function gsQa(): string {
  return `---
description: QA the current diff against the task's acceptance criteria. Use when user says 'test this', 'QA the changes', 'check the diff', 'does this meet the criteria', 'verify the implementation'. Builds a test matrix, traces code paths per scenario, reports PASS/FAIL with file references.
---

# QA — Verification Before Completion

NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE

Before claiming anything passes, you MUST run the command and cite the output. "Should pass" is not evidence. "Probably fine" is not evidence. Run it, read it, then state the result.

## Critical Rules

- **Run all verification commands fresh** — never rely on prior output.
- **Read the actual diff** — do not trust the /gs-work session's summary.
- **Do not trust the implementer** — they finished suspiciously quickly. Verify everything independently.
- **Duplicate code is a CRITICAL bug** — if the same block appears twice in the diff, that is a failure.

## Input

Optional focus area: \`$ARGUMENTS\`

## Context: Current task

Run \`gs-agentic state task current --json --with-spec\` to get your current task.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:**
- \`gs-agentic state task update --id <id> --field value\` — update metadata
- \`gs-agentic state task transition --id <id> --phase <phase>\` — advance phase
- \`gs-agentic state spec set --id <id> --file <path>\` — save spec content
- \`gs-agentic state qa --id <id> --status pass|fail --summary "..."\` — record QA result
- \`gs-agentic state task next --epic <id>\` — find next ready task in an epic

## Step 1: Fresh build verification

Run these commands RIGHT NOW and paste their output:

\`\`\`bash
bun run typecheck
bun test
\`\`\`

Record the results. If either fails, that is an immediate QA failure.

## Step 2: Read the full diff

\`\`\`bash
git diff main...HEAD
\`\`\`

Read EVERY line of the diff. Look specifically for:
- **Duplicate code blocks** — same logic appearing in multiple places (CRITICAL)
- **Unused imports** — imports that nothing references
- **Debug code** — console.log, TODO comments left in
- **Unrelated changes** — modifications outside the task scope

## Step 3: Pass 1 — Spec compliance

For each requirement (from task title, description, or acceptance criteria):
1. Find the code in the diff that addresses this requirement
2. Read it — does it actually implement what's needed?
3. Is there a test for this requirement?
4. Verdict: PASS or FAIL with file:line reference

## Step 4: Pass 2 — Code quality

| Check | What to look for |
|-------|-----------------|
| Duplication | Same code block appearing 2+ times — CRITICAL |
| Error handling | Failure cases handled? |
| Type safety | Proper types, no \`any\`? |
| Edge cases | Empty arrays, null values, missing data? |
| Style | Matches existing codebase patterns? |

Severity:
- **CRITICAL** — Must fix before shipping (bugs, duplicate code, security holes)
- **IMPORTANT** — Should fix (real problems, not dangerous)
- **MINOR** — Note for later (style, could be better)

## Step 5: Report

\`\`\`
## QA Report

**Task:** {id}: {title}
**Diff:** {N} files changed
**Typecheck:** PASS/FAIL (cite command output)
**Tests:** {pass}/{total} (cite command output)

### Pass 1: Spec Compliance

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| {requirement} | PASS/FAIL | {file:line or test output} |

### Pass 2: Code Quality

| # | Issue | Severity | File |
|---|-------|----------|------|
| 1 | {issue} | CRITICAL/IMPORTANT/MINOR | {file:line} |

### Failures

| # | Scenario | Gap | Severity | File |
|---|----------|-----|----------|------|
| 1 | {scenario} | {what's missing} | {severity} | {file:line} |
\`\`\`

## Step 6: Record result

\`\`\`bash
gs-agentic state qa --id <id> --status pass|fail --summary "<one-line summary>"
\`\`\`

## Step 7: Fix CRITICAL issues

If there are CRITICAL issues, fix them now:
- Fix each one
- Run typecheck + tests after each fix
- Re-verify the fix didn't introduce new problems
- Update the QA report
`;
}
