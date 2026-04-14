import { REVIEW_PREAMBLE, HANDOFF_RULE, buildHandoffBlock } from "./preamble.js";

export function gsQuickReview(): string {
  return `---
description: Fast single-pass code review for small changesets. Reviews the current diff for correctness, security, and style in one shot — no subagents, no parallelism. Stores findings in gs-agentic review state. Use for quick sanity checks before committing or when a full deep-review would be overkill.
---

${HANDOFF_RULE}

# Quick Review

Fast, single-pass code review of the current branch's changes.

**Optional arguments:** $ARGUMENTS

${REVIEW_PREAMBLE}

If a task is found, note its title, description, and acceptance criteria — use these to judge whether the changes actually address what was intended.

## Phase 1: Gather Context

Run these commands to understand the current state:

\`\`\`bash
git diff --cached --stat
git diff --stat
git branch --show-current
git merge-base main HEAD
\`\`\`

**Diff strategy (in order of precedence):**

1. If the user passed \`--staged-only\`, use only staged changes: \`git diff --cached\`
2. If the user passed \`--base <branch>\`, use that as the base: \`git diff <branch>...HEAD\`
3. If there are staged changes, review staged changes: \`git diff --cached\`
4. If there are unstaged changes, review all working tree changes: \`git diff\`
5. If the working tree is clean, compare HEAD against the merge-base with main: \`git diff $(git merge-base main HEAD)...HEAD\`

Run the full diff so you have the complete picture. For each changed file, read the FULL file for surrounding context — don't review diffs in isolation.

## Phase 2: Review

Review the changes in a single pass, checking for ALL of the following. Skip any category that doesn't apply to the changeset.

### Task Alignment (if task context available)
- Do the changes address the task's stated goals?
- Are there acceptance criteria that aren't met by this diff?
- Are there changes that go beyond the task's scope?

### Correctness & Logic
- Do conditionals cover all cases? Any inverted logic or off-by-one errors?
- Are optional/nullable values handled? Are array-empty and zero-value edge cases covered?
- Do early returns and error paths behave correctly?
- Are async operations awaited? Are promises handled?
- If state or status transitions are involved, are all transitions valid?

### Security & Data Safety
- Are new routes/endpoints properly authenticated and authorized?
- Is user input validated before use? Any injection risks (SQL, XSS, command)?
- Are sensitive fields excluded from responses and logs?
- Any secret handling issues?

### API & Schema Consistency
- Do contract schemas match their router implementations?
- Are schemas consistent?
- Are there breaking changes to existing endpoints?

### Types & Style
- Any \`any\` casts or type assertions that weaken safety?
- Do variable/function names match their actual semantics?
- Are there unused imports, dead code, or leftover debugging artifacts?
- Does the code follow existing patterns in the codebase?

### Tests
- Is significant new logic covered by tests (or is coverage clearly missing)?
- If tests were changed, do assertions still make sense?

## Phase 3: Store and Report

### Store findings in DB

If a task was found and there are findings:

\`\`\`bash
# Create the review record
REVIEW_ID=$(gs-agentic state review create --task <task-id> --source quick_review \\
  --commit-sha $(git rev-parse HEAD) --summary "Quick review")

# For each finding:
gs-agentic state review add-item --review $REVIEW_ID \\
  --body "<finding description>" \\
  --file "<path>" --line <line> \\
  --severity <CRITICAL|HIGH|MEDIUM|LOW|NITPICK> \\
  --agents "quick_review" \\
  --impact "<why it matters>" \\
  --suggested-fix "<how to resolve>"
\`\`\`

### Report

Output the following format:

\`\`\`
## Quick Review Results

**Branch:** {branch name}
**Base:** {base reference}
**Task:** {task id}: {task title} (or "No task" if ad-hoc)
**Files reviewed:** {count}

### Findings

| # | Severity | Finding | File |
|---|----------|---------|------|
| 1 | CRITICAL | Description | path:line |
| 2 | HIGH     | Description | path:line |
| ... | ... | ... | ... |

### Details

{For each CRITICAL or HIGH finding, include:}

1. **[SEVERITY]** Finding description
   - File: \`path/to/file.ts:123\`
   - Fix: Suggested resolution

### Notes

{Any MEDIUM/LOW/NITPICK observations as a brief bullet list. Keep it tight — no more than 5 bullets.}
\`\`\`

If there are NO findings at all, just say:

\`\`\`
## Quick Review Results

**Branch:** {branch name} | **Files:** {count} | **Task:** {task id}: {title} (or "ad-hoc")

**LGTM** — No issues found. Ship it.
\`\`\`

### Verdict

End with one of:
- **SHIP IT** — No critical or high findings.
- **NEEDS FIXES** — Has findings that should be addressed before merging.

**If SHIP IT:**

${buildHandoffBlock({
  question: "Review clean — no critical or high findings. What's next?",
  header: "Next step",
  options: [
    { label: "QA (Recommended)", description: "Run QA against the task's acceptance criteria", action: 'Skill("qa")' },
    { label: "Ship it", description: "Typecheck, commit, push, and create a PR", action: 'Skill("ship")' },
    { label: "Done for now", description: "Stop here — come back later", action: "stop" },
  ],
  freeText: "the user is giving direction — follow their instructions",
})}

**If NEEDS FIXES:**

${buildHandoffBlock({
  question: "Review found issues that need addressing. What's next?",
  header: "Next step",
  options: [
    { label: "Plan the fixes (Recommended)", description: "Create a structured fix plan with /deep-plan", action: 'Skill("deep-plan", args: "<one-line summary of each CRITICAL and HIGH finding>")' },
    { label: "QA anyway", description: "Run QA to see full acceptance criteria status", action: 'Skill("qa")' },
    { label: "Ship anyway", description: "Skip unresolved findings — typecheck, commit, push, and create a PR", action: 'Skill("ship")' },
    { label: "Done for now", description: "Stop here — address findings later", action: "stop" },
  ],
  freeText: "the user is giving direction — follow their instructions",
})}
`;
}
