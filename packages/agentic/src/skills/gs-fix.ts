export function gsFix(): string {
  return `---
description: Fix bugs or implement changes for the current glorious task. Use when user says 'fix this bug', 'this is broken', 'something's wrong with', 'patch this', or reports specific errors. Classifies issues as bug/scope-change/new-work, fixes code, updates task state if behavior changes.
---

# Fix

You are fixing issues or making changes within the scope of the current glorious task.

## Critical Rules

- **Implement code changes first**, then update the task.
- **Read source files before editing them.**
- The task's **acceptance criteria define what "correct" means**.
- If a fix **contradicts the task's intent**, flag it to the user instead of proceeding.

## Input

The user provides issues to address: \`$ARGUMENTS\`

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

## Process

### Step 1: Understand the issues

Read each issue carefully. Classify each as:
- **Bug** — code doesn't match what the task describes (code changes, task stays)
- **Scope change** — the desired behavior differs from the task's items (both change)
- **New work** — something not covered by the task at all (add items, then implement)

### Step 2: Implement the fixes

For each issue:
1. Read the relevant source files before making changes
2. Implement the fix
3. Typecheck after changes (see CLAUDE.md)

### Step 3: Update the task (if needed)

Only update the task via \`gs-agentic state task update\` if an issue is a **scope change** or **new work**:
- Update the task description: \`gs-agentic state task update --id <id> --description '<updated description>'\`
- Leave unrelated tasks alone

### Step 4: Verify

- Typecheck passes
- Each fix addresses the reported issue
- Task items accurately reflect completed work
`;
}
