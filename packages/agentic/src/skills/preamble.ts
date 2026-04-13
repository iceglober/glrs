/**
 * Role-specific preambles injected into skills that operate on tasks.
 * Each preamble tells the AI how to find the current task and which
 * state mutations are relevant for that role, minimizing token usage.
 */

/**
 * Read-only preamble — for think (strategy skills that must not modify state).
 * Includes only the task lookup and CLAUDE.md instruction, no mutations.
 */
export const READONLY_PREAMBLE = `## Context: Current task

Run \`gs-agentic state task current --json --fields id,title,phase,branch,plan,epic,pr\` to get your current task.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).`;

/**
 * General task preamble — for work, fix, qa, ship, deep-plan.
 * Fetches only the fields these skills need.
 */
export const TASK_PREAMBLE = `## Context: Current task

Run \`gs-agentic state task current --json --fields id,title,phase,branch,plan,epic,pr\` to get your current task.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations (\`--id\` defaults to last-touched task if omitted):**
- \`gs-agentic state task update --id <id> --field value\` — update metadata
- \`gs-agentic state task update --id <id> --depends-on <comma-list>\` — fix dependencies
- \`gs-agentic state task transition --id <id> --phase <phase>\` — advance phase
- \`gs-agentic state task transition --id <id> --phase done --close-and-claim-next\` — close and atomically claim next task in epic
- \`gs-agentic state task transition --ids <comma-list> --phase <phase>\` — batch transition
- \`gs-agentic state task note --id <id> --body "..."\` — attach finding to task
- \`gs-agentic state task note --id <id> --body "..." --ephemeral\` — attach ephemeral note (prunable)
- \`gs-agentic state task notes --id <id> --json\` — list task notes
- \`gs-agentic state task notes --id <id> --prune-ephemeral\` — delete ephemeral notes
- \`gs-agentic state plan set --id <id> --stdin\` — save plan content (pipe via heredoc)
- \`gs-agentic state plan sync --stdin\` — atomic epic+tasks from stdin (pipe line-based format)
- \`gs-agentic state qa --id <id> --status pass|fail --summary "..."\` — record QA result
- \`gs-agentic state task next --epic <id> --claim <actor>\` — atomically find and claim next ready task in an epic

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, \`gs-agentic state task transition\` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use \`--force\` to override if needed.

**Output convention:** All \`create\` and \`add-task\` commands print the machine-readable ID on the **last line** of stdout. Capture it with \`... | tail -1\` — never parse with grep.

**Recipes:**

*Atomic epic + tasks (preferred over individual add-task calls):*
\`\`\`bash
cat <<'SYNC_EOF' | gs-agentic state plan sync --stdin --actor <role>
title: Epic title
description: One-line summary
---
ref:1.1 | Step 1.1: Verb phrase
ref:1.2 | Step 1.2: Verb phrase | depends:1.1
ref:2.1 | Step 2.1: Verb phrase | depends:1.1,1.2
SYNC_EOF
\`\`\`
Returns JSON: \`{ "epicId": "e1", "tasks": { "1.1": "t1", "1.2": "t2", ... } }\`

*Claim → build → done cycle:*
\`\`\`bash
gs-agentic state task next --epic <id> --claim <actor> --json  # claim next ready task
# ... do the work ...
gs-agentic state task transition --id <id> --phase done --actor <actor>
\`\`\``;


/**
 * Review preamble — for deep-review, quick-review, address-feedback.
 * Includes review-specific state mutations instead of general ones.
 */
export const REVIEW_PREAMBLE = `## Context: Current task

Run \`gs-agentic state task current --json --fields id,title,phase,epic,branch,pr\` to get your current task.
If exit code 1 (no task found), proceed without task context.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:**
- \`gs-agentic state review create --task <id> --source <source> --commit-sha <sha>\` — create review
- \`gs-agentic state review add-item --review <id> --body "..." --severity <sev> --agents <agents>\` — add finding
- \`gs-agentic state review list --task <id> --status open --json\` — list open items
- \`gs-agentic state review resolve --item <id> --status <status> --resolution "..." --commit-sha <sha>\` — resolve item
- \`gs-agentic state review summary --task <id> --json\` — review summary counts`;

/**
 * Build preamble — for gs-build, gs-build-loop.
 * Fetches full task with plan for implementation context.
 */
export const BUILD_PREAMBLE = `## Context: Current task

Run \`gs-agentic state task current --json --with-spec\` to get your current task with plan.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations (\`--id\` defaults to last-touched task if omitted):**
- \`gs-agentic state task transition --id <id> --phase <phase>\` — advance phase
- \`gs-agentic state task transition --id <id> --phase done --close-and-claim-next\` — close and atomically claim next task in epic
- \`gs-agentic state task transition --ids <comma-list> --phase <phase>\` — batch transition
- \`gs-agentic state task note --id <id> --body "..."\` — log finding
- \`gs-agentic state task note --id <id> --body "..." --ephemeral\` — log ephemeral finding (prunable)
- \`gs-agentic state task notes --id <id> --prune-ephemeral\` — delete ephemeral notes
- \`gs-agentic state task next --epic <id> --claim <actor>\` — atomically find and claim next ready task in an epic
- \`gs-agentic status --epic <id>\` — show epic progress with bar

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, \`gs-agentic state task transition\` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use \`--force\` to override if needed.

**Output convention:** All \`create\` and \`add-task\` commands print the machine-readable ID on the **last line** of stdout. Capture it with \`... | tail -1\` — never parse with grep.`;

