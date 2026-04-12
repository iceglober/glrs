/**
 * Role-specific preambles injected into skills that operate on tasks.
 * Each preamble tells the AI how to find the current task and which
 * state mutations are relevant for that role, minimizing token usage.
 */

/**
 * General task preamble — for think, work, fix, qa, ship, deep-plan.
 * Fetches only the fields these skills need.
 */
export const TASK_PREAMBLE = `## Context: Current task

Run \`gs-agentic state task current --json --fields id,title,phase,branch,plan,epic,pr\` to get your current task.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:**
- \`gs-agentic state task update --id <id> --field value\` — update metadata
- \`gs-agentic state task transition --id <id> --phase <phase>\` — advance phase
- \`gs-agentic state plan set --id <id> --stdin\` — save plan content (pipe via heredoc)
- \`gs-agentic state qa --id <id> --status pass|fail --summary "..."\` — record QA result
- \`gs-agentic state task next --epic <id>\` — find next ready task in an epic`;

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

**State mutations:**
- \`gs-agentic state task transition --id <id> --phase <phase>\` — advance phase
- \`gs-agentic state task next --epic <id>\` — find next ready task in an epic`;
