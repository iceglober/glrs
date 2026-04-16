import { AUTO_PREAMBLE } from "./preamble.js";
import type { SkillEntry } from "./index.js";

export function gsPlanLoop(): SkillEntry {
  return { "SKILL.md": `---
name: plan-loop
description: Poll for unplanned work requests (tasks in understand phase), research and plan them into epics. Use when you want autonomous planning of queued work requests. Run in a dedicated Claude session alongside /auto-loop sessions.
argument-hint: "[epic-filter]"
disable-model-invocation: true
---

# Plan Loop — Autonomous Planning Agent

Poll for standalone tasks in \`understand\` phase (work requests submitted via the web dashboard), claim them, run research + deep-plan to create actionable epics, and loop back.

## Input

Optional: \`$ARGUMENTS\` — not typically used. The skill auto-discovers unplanned tasks.

${AUTO_PREAMBLE}

## Step 1: Find unplanned work requests

\`\`\`bash
gs-agentic state task list --phase understand --format agent
\`\`\`

Filter the results for tasks that are:
- **Standalone** (no \`epic\` field)
- **Unclaimed** (no \`claimedBy\` field)

If no matching tasks found: report "No pending work requests — waiting for submissions." and stop. The \`/loop\` will retry on the next iteration.

## Step 2: Claim the work request

Pick the first unclaimed standalone \`understand\` task and claim it:

\`\`\`bash
gs-agentic state task transition --id <task-id> --phase design --claim plan-loop --actor plan-loop
\`\`\`

If the claim fails (another agent claimed it first), go back to Step 1 and try the next one.

Read the task's title and description — these are the user's work request prompt.

## Step 3: Research and plan

Use the task's title + description as the research/planning prompt.

Invoke \`/loop\` with the following arguments:

\`\`\`
2m Research and plan the work request below, then stop.

TASK: <task-id> — "<task-title>"
DESCRIPTION: <task-description>

RULES:
1. Run \`/research <task title and description>\` to gather context about what's needed.
2. Run \`/deep-plan <task title and description>\` to create a zero-ambiguity implementation plan.
   - deep-plan will create an epic with tasks automatically.
3. After deep-plan completes, note the epic ID it created.
4. Transition the original work request to done:
   \`gs-agentic state task transition --id <task-id> --phase done --actor plan-loop\`
5. Add a note linking to the new epic:
   \`gs-agentic state task note --id <task-id> --body "Planned as epic <epic-id>"\`
6. Report: "Work request <task-id> planned as <epic-id> with N tasks."
7. Check for more work requests:
   \`gs-agentic state task list --phase understand --format agent\`
   If there are more unclaimed standalone tasks, claim the next one and repeat from step 1.
   If none remain, report "All work requests planned." and stop.
\`\`\`
` };
}
