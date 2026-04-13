export function gsBuildLoop(): string {
  return `---
description: Loop through an epic's tasks, completing one step per iteration. Use when user says 'build-loop', 'execute the plan', 'work through the plan', 'build all the tasks'. Uses gs-agentic state task next to find ready tasks automatically.
---

# Build Loop — Automated Plan Executor

Execute plan steps one at a time. Uses \`gs-agentic state task next --epic <id> --claim build-loop\` to find and atomically claim the next ready task.

## Input

Optional: \`$ARGUMENTS\` — a specific epic ID (e.g. \`e1\`) or a plan file path. If empty, auto-detects.

## Step 1: Find work to do

### Option A: Specific argument provided

If \`$ARGUMENTS\` contains an epic ID (e.g. \`e1\`, \`e2\`):
- Use that as the epic ID and go to Step 2.

If \`$ARGUMENTS\` contains a task ID (e.g. \`t1\`, \`t2\`):
- Look up the task: \`gs-agentic state task show --id <id> --json\`
- If it has an \`epic\` field, use that epic ID and go to Step 2.
- If standalone, execute it directly using \`/build <id>\` and stop.

If \`$ARGUMENTS\` contains a file path:
- Use that plan file and go to Step 3 (plan-file mode).

### Option B: Auto-detect from gs-agentic state

1. Run \`gs-agentic state task current --json\` to find the current task.
2. If a task is found:
   - If it has an \`epic\` field → use that epic ID and go to Step 2.
   - If standalone with a plan file → read it and go to Step 3 (plan-file mode).
3. If no task found:
   - Run \`gs-agentic state epic list --json\` — if exactly one active epic exists, use it.
   - If no epic found → report "No tasks or plans found. Run \`/deep-plan\` first." and stop.

## Step 2: Epic task loop mode

This is the primary execution mode. The epic has child tasks that represent plan steps.

### Read current state

\`\`\`bash
gs-agentic state epic show --id <epic-id> --json
gs-agentic state task list --epic <epic-id> --json
\`\`\`

Read the epic's plan if it exists: \`gs-agentic state plan show --id <epic-id>\`

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

### Find and execute the next task

Use \`gs-agentic state task next --epic <epic-id> --claim build-loop --json --with-spec\` to find and claim the next ready task.

The \`--claim\` flag atomically transitions the task from \`design\` to \`implement\`, preventing other parallel agents from picking up the same task. If another agent already claimed it, the command skips to the next available task.

- If exit code 1 (no ready tasks): check if all tasks are done. If all done, go to the **Epic Complete** section below. If some are blocked, report which tasks are blocked and by what.
- If a task is returned: it is already claimed (in \`implement\` phase). Execute it.

### Execute the task

Invoke \`/loop\` with the following arguments:

\`\`\`
1m Execute the next gs-agentic task following the rules below, then stop.

TASK: <task-id> — "<task-title>"
EPIC: <epic-id>

RULES:
1. Run \`gs-agentic state task show --id <task-id> --json --with-spec\` to get full details.
2. If the task has a plan, read it: \`gs-agentic state plan show --id <task-id>\`
3. Read the epic plan for overall context: \`gs-agentic state plan show --id <epic-id>\`
4. Find the matching step in the plan — read ALL files listed in that step.
5. The task is already in implement phase (claimed by --claim). No need to transition.
6. Read CLAUDE.md for build/test commands.
7. If the step has test cases: write tests FIRST, run them, confirm they fail.
8. Write the implementation.
9. Run verification: typecheck + tests. No exceptions.
10. If tests fail: fix until green.
11. Close task and claim next: \`gs-agentic state task transition --id <task-id> --phase done --close-and-claim-next --actor build-loop\`
12. Commit all changes with message: \`<task title>\`
13. Report: Completed task, verification result, remaining count.
14. If the close-and-claim-next output includes a nextId, repeat from step 1 with the new task.
15. If no tasks remain: report "All tasks complete." and stop.
\`\`\`

## Epic Complete

When all tasks in the epic are done, use the AskUserQuestion tool:

\`\`\`
question: "All tasks complete! What would you like to do next?"
header: "Next step"
options:
  1. label: "Deep review (Recommended)", description: "Thorough multi-agent parallel code review"
  2. label: "Quick review", description: "Fast single-pass code review of the diff"
  3. label: "Ship it", description: "Typecheck, review, commit, push, and create a PR"
  4. label: "Done for now", description: "Stop here — come back later"
\`\`\`

Based on the user's response:
- **Deep review**: invoke the deep-review skill using the Skill tool: Skill("deep-review")
- **Quick review**: invoke the quick-review skill using the Skill tool: Skill("quick-review")
- **Ship it**: invoke the ship skill using the Skill tool: Skill("ship")
- **Done for now**: summarize what was built, then stop

## Step 3: Plan-file fallback mode

Used when no gs-agentic epic/tasks exist but a plan file is available.

Invoke \`/loop\` with the following arguments:

\`\`\`
1m Complete the next unchecked step from <plan-file-path> following the rules below, then stop. If no unchecked steps remain, report "Plan complete" and stop.

RULES:
1. Read the plan file. Find the FIRST line matching \`- [ ] **\`.
2. If no \`- [ ]\` lines remain: say "Plan complete. All items checked off." and stop.
3. Verify all PREVIOUS steps are \`- [x]\`. If not, stop and report which is incomplete.
4. Read CLAUDE.md for build/test commands.
5. Read every file listed in the step.
6. If the step has test cases: write tests FIRST, run them, confirm they fail.
7. Write the implementation.
8. Run the verification command from the step's \`Run:\` line. No exceptions.
9. If tests fail: fix until green.
10. Edit the plan file: change \`- [ ]\` to \`- [x]\` for the completed step.
11. Commit all changes (code + updated plan) with message: \`Plan step N.M: <step title verb phrase>\`
12. Report: Completed step, verification result, remaining count.
\`\`\`
`;
}
