import { TASK_PREAMBLE } from "./preamble.js";

export function gsFix(): string {
  return `---
description: Fix bugs or implement changes for the current glorious task. Use when user says 'fix this bug', 'this is broken', 'something's wrong with', 'patch this', or reports specific errors. Classifies issues as bug/scope-change/new-work, reproduces with a failing test, fixes code, verifies fully.
---

# Fix — Test-Driven Bug Resolution

Reproduce the bug with a failing test. Fix the code. Watch the test pass.

If you can't write a test that fails, you don't understand the bug yet.

## Critical Rules

- **Reproduce first, fix second.** Write a test that demonstrates the bug before touching production code.
- **Read source files before editing them.**
- The task's **acceptance criteria define what "correct" means**.
- If a fix **contradicts the task's intent**, flag it to the user instead of proceeding.

## Input

The user provides issues to address: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Step 1: Understand and classify

Read each issue carefully. Classify each as:
- **Bug** — code doesn't match what the task describes (code changes, task stays)
- **Scope change** — the desired behavior differs from the task's items (both change)
- **New work** — something not covered by the task at all (add items, then implement)

## Step 2: Read the current diff

Determine what has changed to understand the context:

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

Read the full diff and the relevant source files to understand the area you're working in.

## Step 3: RED — Write a failing reproduction test

For each issue:

1. Find or create the appropriate test file (\`<module>.test.ts\` next to the source)
2. Write a test that **reproduces the bug** — it should fail with the current code
3. Run the test suite:
   \`\`\`bash
   bun test
   \`\`\`
4. **Confirm: your new test FAILS.** If it passes, your test doesn't capture the bug — rewrite it.

**If the bug is genuinely untestable** (e.g. a typo in a log message, a cosmetic issue), note why and proceed to Step 4. This should be rare.

## Step 4: GREEN — Fix the code

1. Write the **minimal change** that fixes the bug and makes the failing test pass
2. Don't refactor unrelated code
3. Don't add features beyond the fix
4. Run the test suite:
   \`\`\`bash
   bun test
   \`\`\`
5. **Confirm: ALL tests pass** (new and existing)

## Step 5: Update the task (if needed)

Only update the task via \`gs-agentic state task update\` if an issue is a **scope change** or **new work**:
- Update the task description: \`gs-agentic state task update --id <id> --description '<updated description>'\`
- Leave unrelated tasks alone

## Step 6: Full verification

Run all checks — no exceptions:

\`\`\`bash
bun run typecheck
bun test
bun run build
\`\`\`

Then review your own changes:

\`\`\`bash
git diff
\`\`\`

Check for:
- Debug code left in (console.log, TODO)
- Unused imports
- Duplicate code blocks
- Unrelated changes

**Do not declare done until all checks pass.**

## Step 7: Report

\`\`\`
## Fixed

**Task:** {id}: {title}
**Issues:** {count} addressed
**Classification:** {bug|scope-change|new-work for each}
**Tests:** {pass}/{total} (all green)
**Typecheck:** clean
**Build:** clean

### Changes
| # | Issue | Classification | Fix | Test |
|---|-------|---------------|-----|------|
| 1 | {description} | Bug | {what changed} | {test name or "N/A"} |
\`\`\`
`;
}
