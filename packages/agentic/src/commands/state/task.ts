import { command, subcommands, positional, option, flag, optional, string } from "cmd-ts";
import {
  createTask,
  loadTask,
  listTasks,
  transitionTask,
  saveTask,
  deriveEpicPhase,
  isTerminal,
  PHASES,
  type Phase,
} from "../../lib/state.js";
import { ok, warn, bold, dim, cyan, green, yellow, red } from "../../lib/fmt.js";

// ── gs-agentic state task create ─────────────────────────────────────────────

const create = command({
  name: "create",
  description: "Create a new task",
  args: {
    title: option({ type: string, long: "title", short: "t", description: "Task title" }),
    description: option({ type: optional(string), long: "description", short: "d", description: "Task description" }),
    parent: option({ type: optional(string), long: "parent", short: "p", description: "Parent task ID (creates workstream)" }),
    phase: option({ type: optional(string), long: "phase", description: "Initial phase (default: understand)" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name for transition log" }),
  },
  handler: (args) => {
    const phase = (args.phase as Phase) ?? undefined;
    if (phase && !PHASES.includes(phase)) {
      console.error(`Invalid phase: "${phase}". Valid: ${PHASES.join(", ")}`);
      process.exit(1);
    }
    const task = createTask({
      title: args.title,
      description: args.description ?? "",
      parent: args.parent ?? undefined,
      phase,
      actor: args.actor ?? undefined,
    });
    ok(`created task ${bold(task.id)}: ${task.title}`);
    console.log(task.id); // machine-readable output on last line
  },
});

// ── gs-agentic state task show ───────────────────────────────────────────────

const show = command({
  name: "show",
  description: "Show task details",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const task = loadTask(args.id);
    if (!task) {
      console.error(`Task "${args.id}" not found.`);
      process.exit(1);
    }

    // For epics, derive the phase from children
    if (task.children.length > 0) {
      task.phase = deriveEpicPhase(task.id);
    }

    if (args.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }

    const phaseColor = {
      understand: cyan,
      design: (s: string) => `\x1b[35m${s}\x1b[0m`, // purple
      implement: yellow,
      verify: cyan,
      ship: green,
      done: dim,
      cancelled: dim,
    }[task.phase] ?? dim;

    console.log(`${bold(task.id)}: ${task.title}`);
    console.log(`  phase: ${phaseColor(task.phase)}`);
    if (task.description) console.log(`  desc:  ${task.description}`);
    if (task.branch) console.log(`  branch: ${task.branch}`);
    if (task.worktree) console.log(`  worktree: ${task.worktree}`);
    if (task.pr) console.log(`  pr: ${task.pr}`);
    if (task.spec) console.log(`  spec: ${task.spec}`);
    if (task.parent) console.log(`  parent: ${task.parent}`);
    if (task.children.length > 0) console.log(`  children: ${task.children.join(", ")}`);
    if (task.dependencies.length > 0) console.log(`  depends: ${task.dependencies.join(", ")}`);
    if (task.qaResult) {
      const qc = task.qaResult.status === "pass" ? green : red;
      console.log(`  qa: ${qc(task.qaResult.status)} — ${task.qaResult.summary}`);
    }
  },
});

// ── gs-agentic state task transition ─────────────────────────────────────────

const transition = command({
  name: "transition",
  description: "Move task to a new phase",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
    phase: option({ type: string, long: "phase", short: "p", description: "Target phase" }),
    force: flag({ long: "force", short: "f", description: "Allow backward transitions" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name for log" }),
  },
  handler: (args) => {
    if (!PHASES.includes(args.phase as Phase)) {
      console.error(`Invalid phase: "${args.phase}". Valid: ${PHASES.join(", ")}`);
      process.exit(1);
    }
    try {
      const task = transitionTask(args.id, args.phase as Phase, {
        force: args.force,
        actor: args.actor ?? undefined,
      });
      ok(`${bold(task.id)} → ${task.phase}`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  },
});

// ── gs-agentic state task update ─────────────────────────────────────────────

const update = command({
  name: "update",
  description: "Update task metadata",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
    title: option({ type: optional(string), long: "title", description: "New title" }),
    description: option({ type: optional(string), long: "description", description: "New description" }),
    branch: option({ type: optional(string), long: "branch", description: "Branch name" }),
    worktree: option({ type: optional(string), long: "worktree", description: "Worktree path" }),
    pr: option({ type: optional(string), long: "pr", description: "PR URL" }),
  },
  handler: (args) => {
    const task = loadTask(args.id);
    if (!task) {
      console.error(`Task "${args.id}" not found.`);
      process.exit(1);
    }
    if (args.title !== undefined) task.title = args.title;
    if (args.description !== undefined) task.description = args.description;
    if (args.branch !== undefined) task.branch = args.branch;
    if (args.worktree !== undefined) task.worktree = args.worktree;
    if (args.pr !== undefined) task.pr = args.pr;
    saveTask(task);
    ok(`updated ${bold(task.id)}`);
  },
});

// ── gs-agentic state task cancel ─────────────────────────────────────────────

const cancel = command({
  name: "cancel",
  description: "Cancel a task",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name" }),
  },
  handler: (args) => {
    try {
      const task = transitionTask(args.id, "cancelled", {
        force: false,
        actor: args.actor ?? undefined,
      });
      ok(`${bold(task.id)} cancelled`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  },
});

// ── gs-agentic state task list ───────────────────────────────────────────────

const list = command({
  name: "list",
  description: "List tasks",
  args: {
    phase: option({ type: optional(string), long: "phase", description: "Filter by phase" }),
    parent: option({ type: optional(string), long: "parent", description: "Filter by parent ID" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    let tasks = listTasks();

    // Derive epic phases
    for (const t of tasks) {
      if (t.children.length > 0) {
        t.phase = deriveEpicPhase(t.id);
      }
    }

    if (args.phase) {
      tasks = tasks.filter((t) => t.phase === args.phase);
    }
    if (args.parent) {
      tasks = tasks.filter((t) => t.parent === args.parent);
    }

    if (args.json) {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }

    if (tasks.length === 0) {
      console.log(dim("No tasks found."));
      return;
    }

    for (const t of tasks) {
      const icon = isTerminal(t.phase) ? (t.phase === "done" ? "✓" : "✗") : "●";
      console.log(`  ${icon} ${bold(t.id)} ${t.title} ${dim(`[${t.phase}]`)}${t.branch ? dim(` ${t.branch}`) : ""}`);
    }
  },
});

// ── Export subcommands ───────────────────────────────────────────────

export const stateTask = subcommands({
  name: "task",
  description: "Task management",
  cmds: {
    create,
    show,
    transition,
    update,
    cancel,
    list,
  },
});
