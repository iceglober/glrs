/**
 * Shared preamble injected into skills that operate on a task.
 * Tells the AI how to find and read the current task via `gs-agentic state`.
 */
export const TASK_PREAMBLE = `## Context: Current task

Run \\\`gs-agentic state task list --json\\\` and find the task whose \\\`branch\\\` field matches the current branch (\\\`git branch --show-current\\\`). This is your **current task**.

If no task matches, this branch isn't linked to a glorious task — operate in ad-hoc mode without state tracking.

If a task is found, run \\\`gs-agentic state task show --id <id> --json\\\` to get full details. The task has:
- \\\`id\\\` — task identifier (e.g. "t3")
- \\\`title\\\` — short description
- \\\`description\\\` — full context
- \\\`phase\\\` — understand | design | implement | verify | ship | done | cancelled
- \\\`spec\\\` — path to spec file (if exists)
- \\\`dependencies\\\` — array of task IDs that must complete before this task can start
- \\\`branch\\\` — the git branch for this task
- \\\`pr\\\` — PR URL if shipped
- \\\`qaResult\\\` — latest QA result (if any)

If the task has a spec, run \\\`gs-agentic state spec show --id <id>\\\` to read it.

Also read \\\`CLAUDE.md\\\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:** Use \\\`gs-agentic state\\\` commands for all changes:
- \\\`gs-agentic state task update --id <id> --field value\\\` — update metadata
- \\\`gs-agentic state task transition --id <id> --phase <phase>\\\` — advance phase
- \\\`gs-agentic state spec set --id <id> --file <path>\\\` — save spec content
- \\\`gs-agentic state qa --id <id> --status pass|fail --summary "..."\\\` — record QA result`;
