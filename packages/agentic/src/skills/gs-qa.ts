import { REVIEW_PREAMBLE } from "./preamble.js";

export function gsQa(): string {
  return `---
description: QA the current diff against the task's acceptance criteria. Use when user says 'test this', 'QA the changes', 'check the diff', 'does this meet the criteria', 'verify the implementation'. Builds a test matrix, traces code paths per scenario, reports findings with file references, stores results in review DB.
---

# QA — Verification Before Completion

NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE

Before claiming anything passes, you MUST run the command and cite the output. "Should pass" is not evidence. "Probably fine" is not evidence. Run it, read it, then state the result.

## Critical Rules

- **Run all verification commands fresh** — never rely on prior output.
- **Read the actual diff** — do not trust the /work session's summary.
- **Do not trust the implementer** — they finished suspiciously quickly. Verify everything independently.
- **Duplicate code is a CRITICAL bug** — if the same block appears twice in the diff, that is a failure.

## Input

Optional focus area: \`$ARGUMENTS\`

${REVIEW_PREAMBLE}

If a task is found, note its title, description, and acceptance criteria — use these to judge whether the changes actually address what was intended.

## Step 1: Determine the diff

\`\`\`bash
git diff --cached --stat
git diff --stat
git branch --show-current
git merge-base main HEAD
\`\`\`

**Diff strategy (in order of precedence):**
1. If there are staged changes: \`git diff --cached\`
2. If there are unstaged changes: \`git diff\`
3. If the working tree is clean: \`git diff $(git merge-base main HEAD)...HEAD\`

Store the chosen diff command. Run it to get the full diff. For each changed file, read the FULL file for surrounding context.

## Step 2: Fresh build verification

Run these commands RIGHT NOW and paste their output:

\`\`\`bash
bun run typecheck
bun test
bun run build
\`\`\`

Record the results. If ANY fails, that is an immediate QA failure — report it and stop.

## Step 3: Pass 1 — Spec compliance

For each requirement (from task title, description, or acceptance criteria):
1. Find the code in the diff that addresses this requirement
2. Read it — does it actually implement what's needed?
3. Is there a test for this requirement?
4. Verdict: PASS or FAIL with file:line reference

## Step 4: Pass 2 — Code quality

Read EVERY line of the diff. Check for:

| Check | What to look for |
|-------|-----------------|
| Duplication | Same code block appearing 2+ times — CRITICAL |
| Error handling | Failure cases handled? |
| Type safety | Proper types, no \`any\`? |
| Edge cases | Empty arrays, null values, missing data? |
| Style | Matches existing codebase patterns? |
| Debug artifacts | console.log, TODO comments left in |
| Unused imports | Imports that nothing references |
| Unrelated changes | Modifications outside the task scope |

Severity:
- **CRITICAL** — Must fix before shipping (bugs, duplicate code, security holes)
- **HIGH** — Should fix before shipping (real problems)
- **MEDIUM** — Should fix (not dangerous but incorrect)
- **LOW** — Note for later (style, could be better)

## Step 5: Store findings in DB

If a task was found and there are findings:

\`\`\`bash
# Create the review record
REVIEW_ID=$(gs-agentic state review create --task <task-id> --source qa \\
  --commit-sha $(git rev-parse HEAD) --summary "QA verification")

# For each finding:
gs-agentic state review add-item --review $REVIEW_ID \\
  --body "<finding description>" \\
  --file "<path>" --line <line> \\
  --severity <CRITICAL|HIGH|MEDIUM|LOW> \\
  --agents "qa" \\
  --impact "<why it matters>" \\
  --suggested-fix "<how to resolve>"
\`\`\`

Also record the pass/fail result:

\`\`\`bash
gs-agentic state qa --id <task-id> --status pass|fail --summary "<one-line summary>"
\`\`\`

## Step 6: Report

\`\`\`
## QA Report

**Branch:** {branch name}
**Base:** {base reference}
**Task:** {task id}: {task title} (or "No task" if ad-hoc)
**Diff:** {N} files changed
**Typecheck:** PASS/FAIL (cite command output)
**Tests:** {pass}/{total} (cite command output)
**Build:** PASS/FAIL

### Pass 1: Spec Compliance

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| {requirement} | PASS/FAIL | {file:line or test output} |

### Pass 2: Code Quality

| # | Severity | Finding | File |
|---|----------|---------|------|
| 1 | CRITICAL | Description | path:line |
| 2 | HIGH     | Description | path:line |

### Details

{For each CRITICAL or HIGH finding:}

1. **[SEVERITY]** Finding description
   - File: \`path/to/file.ts:123\`
   - Fix: Suggested resolution
\`\`\`

### Verdict

End with one of:
- **SHIP IT** — No critical or high findings. All spec requirements pass. Code is ready.
- **NEEDS FIXES** — Has findings that must be addressed before shipping.

## Step 7: Fix CRITICAL issues

If there are CRITICAL issues, fix them now:
1. Fix each one
2. Run typecheck + tests + build after each fix
3. Re-verify the fix didn't introduce new problems
4. Update the findings in the DB:
   \`\`\`bash
   gs-agentic state review resolve --item <item-id> --status fixed \\
     --resolution "Fixed: <what changed>" --commit-sha $(git rev-parse HEAD)
   \`\`\`
5. Update the QA report

If **NEEDS FIXES** with only HIGH/MEDIUM findings, ask the user how to proceed.
`;
}
