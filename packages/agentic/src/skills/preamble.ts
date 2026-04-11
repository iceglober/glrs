/**
 * Shared preamble injected into skills that operate on a task.
 * Tells the AI how to find and read the current task via `gs-agentic state`.
 */
export const TASK_PREAMBLE = `## Context: Current task

Run \\\`gs-agentic state task current --json --with-spec\\\` to get your current task.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \\\`CLAUDE.md\\\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:**
- \\\`gs-agentic state task update --id <id> --field value\\\` — update metadata
- \\\`gs-agentic state task transition --id <id> --phase <phase>\\\` — advance phase
- \\\`gs-agentic state spec set --id <id> --file <path>\\\` — save spec content
- \\\`gs-agentic state qa --id <id> --status pass|fail --summary "..."\\\` — record QA result
- \\\`gs-agentic state task next --epic <id>\\\` — find next ready task in an epic`;
