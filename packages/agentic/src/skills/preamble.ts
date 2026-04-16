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

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, \`gs-agentic state task transition\` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use \`--force\` to override non-terminal claims if needed.

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

// ── Skill handoff ──────────────────────────────────────────────────

/**
 * Global constraint injected into skills that hand off to other skills
 * after AskUserQuestion. Uses Authority + Commitment persuasion.
 */
export const HANDOFF_RULE = `## Skill Handoff Rule

When this skill tells you to call the Skill tool, your IMMEDIATE next action MUST be that Skill tool call — no text, no summary, no confirmation.

CORRECT: Use the Skill tool with the parameter shown in the dispatch table. Your response body must be EMPTY — no text at all, only the tool call.

WRONG — these do NOTHING and the user sees a dead message:
- Outputting \`/skill-name\` as text — slash commands only work when the USER types them, not when you output them
- Outputting \`Skill("name")\` as text — this is not a tool call, it is just characters on screen
- Writing any words before, after, or instead of the tool call

### Red Flags — STOP if you are about to:
- Type a forward slash followed by a command name — that is text, not a tool call
- Write any words before the tool call — delete them, send only the tool call
- Summarize what happened before dispatching — the next skill will handle that`;

export interface HandoffOption {
  label: string;
  description: string;
  /** Use `Skill("name")` or `Skill("name", args: "...")` format — buildHandoffBlock normalizes to tool-call display format. Non-Skill actions (e.g. "stop") pass through as-is. */
  action: string;
}

/**
 * Build a standardized AskUserQuestion + dispatch block for skill handoffs.
 * Produces: AskUserQuestion YAML, dispatch table, constraint block.
 */
export function buildHandoffBlock(opts: {
  question: string;
  header: string;
  options: HandoffOption[];
  freeText?: string;
}): string {
  // Build AskUserQuestion YAML
  const optLines = opts.options
    .map((o, i) => `  ${i + 1}. label: "${o.label}", description: "${o.description}"`)
    .join("\n");

  const askBlock = `Use the AskUserQuestion tool:

\`\`\`
question: "${opts.question}"
header: "${opts.header}"
options:
${optLines}
\`\`\``;

  // Build dispatch table with explicit tool call format
  const tableRows = opts.options
    .map((o) => {
      // Normalize Skill("name") and Skill("name", args: "...") to explicit tool-call format
      let action = o.action;
      if (action.startsWith("Skill(")) {
        const m = action.match(
          /^Skill\("([^"]+)"(?:,\s*args:\s*"([^"]*)")?\)$/,
        );
        if (!m) throw new Error(`Unrecognized Skill() format: ${action}`);
        action = m[2]
          ? `Call Skill tool → skill: "${m[1]}", args: "${m[2]}"`
          : `Call Skill tool → skill: "${m[1]}"`;
      }
      return `| "${o.label}" | ${action} |`;
    })
    .join("\n");

  const freeTextRow = opts.freeText
    ? `\n| Other (free text) | ${opts.freeText} |`
    : "";

  const dispatchBlock = `## DISPATCH — Execute IMMEDIATELY after user responds

| User selects | YOUR ACTION (tool call, not text) |
|---|---|
${tableRows}${freeTextRow}`;

  // Constraint block — use first Skill action for contextual WRONG example
  const firstSkillOpt = opts.options.find((o) => o.action.startsWith("Skill("));
  const exampleSlash = firstSkillOpt
    ? `/${firstSkillOpt.action.match(/^Skill\("([^"]+)"/)?.[1] ?? "skill-name"}`
    : "/skill-name";

  const constraint = `**CONSTRAINT:** Your response after the user answers MUST contain ONLY the Skill tool call — no text whatsoever.

WRONG: outputting \`${exampleSlash}\` or any slash command as text (does nothing)
WRONG: any words before or instead of the tool call
CORRECT: a single Skill tool call as the entire response`;

  return `${askBlock}

${dispatchBlock}

${constraint}`;
}

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
- \`gs-agentic state task notes --id <id> --json\` — list task notes
- \`gs-agentic state task notes --id <id> --prune-ephemeral\` — delete ephemeral notes
- \`gs-agentic state task next --epic <id> --claim <actor>\` — atomically find and claim next ready task in an epic
- \`gs-agentic status --epic <id>\` — show epic progress with bar

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, \`gs-agentic state task transition\` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use \`--force\` to override non-terminal claims if needed.

**Output convention:** All \`create\` and \`add-task\` commands print the machine-readable ID on the **last line** of stdout. Capture it with \`... | tail -1\` — never parse with grep.`;

/**
 * Autonomous preamble — for plan-loop, auto-loop.
 * Extends BUILD_PREAMBLE with autonomous-specific directives:
 * no user interaction, note storage, failure budget, token-efficient output.
 */
export const AUTO_PREAMBLE = `## Context: Current task

Run \`gs-agentic state task current --format agent --with-spec\` to get your current task with plan.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

## Autonomous Mode

You are running as an autonomous agent. Follow these rules strictly:

1. **Do not ask the user questions.** You must never prompt for input. Make reasonable decisions based on the plan and codebase context.
2. **Store all findings in task notes.** Use \`gs-agentic state task note --id <id> --body "..."\` for important findings and summaries. Use \`--ephemeral\` for transient progress updates.
3. **Failure budget: max 2 retry attempts per task.** If typecheck/tests fail after implementing, fix and retry (up to 2 attempts). On the 3rd failure, add a note describing the issue and transition the task to \`cancelled\`.
4. **Use token-efficient output.** Use \`--format agent\` on commands that support it (\`task show\`, \`task current\`, \`task list\`). Use \`--json\` on others (\`task next\`, \`epic list\`). Use \`gs-agentic status --compact --epic <id>\` for progress checks.

**State mutations (\`--id\` defaults to last-touched task if omitted):**
- \`gs-agentic state task transition --id <id> --phase <phase>\` — advance phase
- \`gs-agentic state task transition --id <id> --phase done --close-and-claim-next\` — close and atomically claim next task in epic
- \`gs-agentic state task transition --ids <comma-list> --phase <phase>\` — batch transition
- \`gs-agentic state task note --id <id> --body "..."\` — log finding
- \`gs-agentic state task note --id <id> --body "..." --ephemeral\` — log ephemeral progress (prunable)
- \`gs-agentic state task notes --id <id> --prune-ephemeral\` — clean up progress notes
- \`gs-agentic state task next --epic <id> --claim <actor>\` — atomically find and claim next ready task
- \`gs-agentic status --compact --epic <id>\` — single-line progress summary

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, \`gs-agentic state task transition\` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use \`--force\` to override non-terminal claims if needed.

**Output convention:** All \`create\` and \`add-task\` commands print the machine-readable ID on the **last line** of stdout. Capture it with \`... | tail -1\` — never parse with grep.`;

