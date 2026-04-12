export function gsBuild(): string {
  return `---
description: Implement a specific gs-agentic task. Use when user says 'build t3', 'implement this task', 'work on t5', or provides a specific task ID. Reads the task's plan and context, then implements with TDD methodology. Updates task state on completion.
---

# Build — Implement a Specific Task

You are implementing a specific gs-agentic task. Read it, understand it, build it, verify it.

## The Iron Law

\`\`\`
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
\`\`\`

Write code before the test? Delete it. Start over with a test.

## Input

The user provides a task ID or description: \`$ARGUMENTS\`

## Step 1: Resolve the target task

### If \`$ARGUMENTS\` contains a task ID (e.g. \`t3\`, \`t5\`):

Run \`gs-agentic state task show --id <id> --json --with-spec\` to get full details.

### If \`$ARGUMENTS\` is empty or doesn't contain a task ID:

1. Run \`gs-agentic state task current --json --with-spec\` to find the current task.
2. If the task belongs to an epic (\`epic\` field is set):
   - Run \`gs-agentic state task next --epic <epic-id> --json --with-spec\` to find the next ready task.
   - Use that task as the target.
3. If no epic, use the current task itself.
4. If no task found (exit code 1), report "No task found. Provide a task ID (e.g. \`/build t3\`) or run \`/deep-plan\` first." and stop.

### If \`$ARGUMENTS\` is a free-text description (not a task ID):

1. Look up the current task as above.
2. If it belongs to an epic, search its sibling tasks for one matching the description.
3. If no match, treat it as ad-hoc work — create a task first:
   \`\`\`bash
   gs-agentic state task create --title "<description>" --phase implement
   gs-agentic state task update --id <new-id> --branch "$(git branch --show-current)"
   \`\`\`

## Step 2: Gather context

The target task has:
- \`id\` — task identifier
- \`title\` — short description
- \`description\` — full context
- \`phase\` — current phase
- \`plan\` — path to plan file (if exists)
- \`planContent\` — inline plan content (if --with-spec was used)
- \`dependencies\` — array of task IDs that must complete first
- \`branch\` — the git branch
- \`epic\` — epic ID (if this task belongs to an epic)

1. **Read the task's plan** (if planContent wasn't inline): \`gs-agentic state plan show --id <id>\`
2. **If this belongs to an epic, read the epic's plan too**: \`gs-agentic state plan show --id <epic-id>\` — this is the full plan with file paths, test cases, and signatures.
3. **Read \`CLAUDE.md\`** for project-specific commands (typecheck, build, lint, test).
4. **Read all source files** listed in the task's plan step — every file path mentioned in the plan.
5. **Transition to implement**: \`gs-agentic state task transition --id <id> --phase implement --actor build\`

## Step 3: Plan the increment

From the task plan step, extract:
- What behavior to add
- What test(s) to write
- What file(s) to modify
- What the verification command is

If the plan step has a test cases table, use those exact test cases. If not, define your own:

\`\`\`
## Plan
1. Test: [describe what the test asserts] -> File: [test file path]
   Impl: [describe change] -> File: [source file path]
Verify: <typecheck + test commands from CLAUDE.md>
\`\`\`

## Step 4: Red-Green-Refactor

### RED — Write a failing test

1. Write ONE test that describes the desired behavior
2. Run the test suite
3. **Confirm: your new test FAILS.** If it passes immediately, the test doesn't test anything new — rewrite it.

### GREEN — Write minimal code to pass

1. Write the **simplest code** that makes the failing test pass
2. Don't add features beyond what the test requires
3. Run the test suite — ALL tests pass
4. Run typecheck — zero errors

### REFACTOR (only after green)

- Remove duplication
- Improve names
- Extract helpers if needed
- Keep all tests green

### REPEAT for each test case in the plan step

## Step 5: Final verification

After all test cases are implemented:

1. Run typecheck — zero errors
2. Run tests — ALL pass
3. Run build — succeeds
4. Review the task description line by line — every requirement met?
5. \`git diff\` — no debug code, no unused imports, no duplicate code blocks

**Do not declare done until all 5 checks pass.**

## Step 6: Update state and commit

1. **Transition task to done:**
   \`\`\`bash
   gs-agentic state task transition --id <id> --phase done --actor build
   \`\`\`

2. **Commit changes:**
   - Stage specific files — never \`git add -A\`
   - Commit message: \`<task title>\`
   - End with \`Co-Authored-By: Claude <noreply@anthropic.com>\`

3. **Check if epic is complete** (if this task belongs to an epic):
   \`\`\`bash
   gs-agentic state task list --epic <epic-id> --json
   \`\`\`
   If all tasks are \`done\`, report "All tasks complete — ready for QA."

4. **Report:**
   \`\`\`
   ## Built

   **Task:** {id}: {title}
   **Phase:** done
   **Tests:** {pass}/{total}
   **Typecheck:** clean
   **Remaining tasks in epic:** {count} (if applicable)
   \`\`\`

## Common rationalizations — all invalid

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Testing takes seconds. Write the test. |
| "I'll add tests after" | Tests-after pass immediately, proving nothing. Tests-first prove the feature works. |
| "This is just a flag/config" | If it can break in production, it needs a test. |
| "No existing tests for this area" | Then you're the one who improves it. Create the test file. |
| "The plan step doesn't have test cases" | Then define your own. No code without a failing test. |
`;
}
