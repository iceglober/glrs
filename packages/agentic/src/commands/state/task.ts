import { command, subcommands, option, flag, optional, string } from "cmd-ts";
import {
  createTask,
  loadTask,
  listTasks,
  transitionTask,
  transitionBatch,
  saveTask,
  deriveEpicPhase,
  isTerminal,
  createEpic,
  loadEpic,
  listEpics,
  findCurrentTask,
  findNextTask,
  loadTaskFull,
  addTaskNote,
  loadTaskNotes,
  getLastTouched,
  PHASES,
  type Phase,
} from "../../lib/state.js";
import { gitSafe } from "../../lib/git.js";
import { ok, warn, bold, dim, cyan, green, yellow, red } from "../../lib/fmt.js";

/** Resolve --id: explicit value → last-touched → error */
function resolveId(explicit?: string): string {
  if (explicit) return explicit;
  const last = getLastTouched();
  if (last) return last;
  console.error("No --id provided and no last-touched task found.");
  process.exit(1);
}

// ── gs-agentic state task create ─────────────────────────────────────────────

const create = command({
  name: "create",
  description: "Create a new task",
  args: {
    title: option({ type: string, long: "title", short: "t", description: "Task title" }),
    description: option({ type: optional(string), long: "description", short: "d", description: "Task description" }),
    epic: option({ type: optional(string), long: "epic", short: "e", description: "Epic ID (links task to epic)" }),
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
      epic: args.epic ?? undefined,
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
    id: option({ type: optional(string), long: "id", short: "i", description: "Task ID (defaults to last-touched)" }),
    json: flag({ long: "json", description: "Output as JSON" }),
    withSpec: flag({ long: "with-spec", description: "Include spec content" }),
    fields: option({ type: optional(string), long: "fields", description: "Comma-separated field names to include" }),
  },
  handler: (args) => {
    const id = resolveId(args.id);
    const fieldList = args.fields?.split(",").map((f) => f.trim());
    const full = loadTaskFull(id, { withSpec: args.withSpec, fields: fieldList });
    if (!full) {
      console.error(`Task "${id}" not found.`);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(full));
      return;
    }

    const task = loadTask(id)!;
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
    if (task.plan) console.log(`  plan: ${task.plan}`);
    if (task.claimedBy) console.log(`  claimed: ${yellow(task.claimedBy)} ${dim(`since ${task.claimedAt}`)}`);
    if (task.epic) console.log(`  epic: ${task.epic}`);
    if (task.dependencies.length > 0) console.log(`  depends: ${task.dependencies.join(", ")}`);
    if (task.qaResult) {
      const qc = task.qaResult.status === "pass" ? green : red;
      console.log(`  qa: ${qc(task.qaResult.status)} — ${task.qaResult.summary}`);
    }
  },
});

// ── gs-agentic state task current ────────────────────────────────────────────

const current = command({
  name: "current",
  description: "Show the task for the current worktree/branch",
  args: {
    json: flag({ long: "json", description: "Output as JSON" }),
    withSpec: flag({ long: "with-spec", description: "Include spec content" }),
    fields: option({ type: optional(string), long: "fields", description: "Comma-separated field names" }),
  },
  handler: (args) => {
    const worktree = gitSafe("rev-parse", "--show-toplevel") ?? "";
    const branch = gitSafe("rev-parse", "--abbrev-ref", "HEAD") ?? "";

    const task = findCurrentTask(worktree, branch);
    if (!task) {
      console.error("No task found for current worktree/branch.");
      process.exit(1);
    }

    const fieldList = args.fields?.split(",").map((f) => f.trim());
    const full = loadTaskFull(task.id, { withSpec: args.withSpec, fields: fieldList });

    if (args.json) {
      console.log(JSON.stringify(full));
      return;
    }

    console.log(`${bold(task.id)}: ${task.title} ${dim(`[${task.phase}]`)}`);
    if (task.epic) console.log(`  epic: ${task.epic}`);
    if (task.branch) console.log(`  branch: ${task.branch}`);
  },
});

// ── gs-agentic state task next ───────────────────────────────────────────────

const next = command({
  name: "next",
  description: "Find the next ready task in an epic",
  args: {
    epic: option({ type: string, long: "epic", short: "e", description: "Epic ID" }),
    claim: option({ type: optional(string), long: "claim", description: "Claim the task atomically (transitions to implement)" }),
    json: flag({ long: "json", description: "Output as JSON" }),
    withSpec: flag({ long: "with-spec", description: "Include spec content" }),
    fields: option({ type: optional(string), long: "fields", description: "Comma-separated field names" }),
  },
  handler: (args) => {
    const task = findNextTask(args.epic, args.claim ? { claim: args.claim } : undefined);
    if (!task) {
      console.error(`No ready tasks in epic "${args.epic}".`);
      process.exit(1);
    }

    const fieldList = args.fields?.split(",").map((f) => f.trim());
    const full = loadTaskFull(task.id, { withSpec: args.withSpec, fields: fieldList });

    if (args.json) {
      console.log(JSON.stringify(full));
      return;
    }

    console.log(`${bold(task.id)}: ${task.title} ${dim(`[${task.phase}]`)}`);
  },
});

// ── gs-agentic state task transition ─────────────────────────────────────────

const transition = command({
  name: "transition",
  description: "Move task(s) to a new phase",
  args: {
    id: option({ type: optional(string), long: "id", short: "i", description: "Task ID (defaults to last-touched)" }),
    ids: option({ type: optional(string), long: "ids", description: "Comma-separated task IDs (batch)" }),
    phase: option({ type: string, long: "phase", short: "p", description: "Target phase" }),
    force: flag({ long: "force", short: "f", description: "Allow backward transitions" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name for log" }),
  },
  handler: (args) => {
    if (args.id && args.ids) {
      console.error("Provide --id or --ids, not both.");
      process.exit(1);
    }
    if (!PHASES.includes(args.phase as Phase)) {
      console.error(`Invalid phase: "${args.phase}". Valid: ${PHASES.join(", ")}`);
      process.exit(1);
    }

    if (args.ids) {
      const idList = args.ids.split(",").map((s) => s.trim()).filter(Boolean);
      const { succeeded, failed } = transitionBatch(idList, args.phase as Phase, {
        force: args.force,
        actor: args.actor ?? undefined,
      });
      for (const t of succeeded) ok(`${bold(t.id)} → ${t.phase}`);
      for (const f of failed) console.error(`${bold(f.id)}: ${f.error}`);
      if (failed.length > 0) process.exit(1);
    } else {
      try {
        const id = resolveId(args.id);
        const task = transitionTask(id, args.phase as Phase, {
          force: args.force,
          actor: args.actor ?? undefined,
        });
        ok(`${bold(task.id)} → ${task.phase}`);
        const unblocked = (task as any).unblocked as Array<{ id: string; title: string }> | undefined;
        if (unblocked?.length) {
          for (const u of unblocked) {
            console.log(`  ${green("▸")} Unblocked: ${bold(u.id)} ${u.title}`);
          }
        }
        const epicClosed = (task as any).epicClosed as { epicId: string; phase: string } | undefined;
        if (epicClosed) {
          ok(`Epic ${bold(epicClosed.epicId)} auto-closed → ${epicClosed.phase}`);
        }
      } catch (e: any) {
        console.error(e.message);
        process.exit(1);
      }
    }
  },
});

// ── gs-agentic state task update ─────────────────────────────────────────────

const update = command({
  name: "update",
  description: "Update task metadata",
  args: {
    id: option({ type: optional(string), long: "id", short: "i", description: "Task ID (defaults to last-touched)" }),
    title: option({ type: optional(string), long: "title", description: "New title" }),
    description: option({ type: optional(string), long: "description", description: "New description" }),
    branch: option({ type: optional(string), long: "branch", description: "Branch name" }),
    worktree: option({ type: optional(string), long: "worktree", description: "Worktree path" }),
    pr: option({ type: optional(string), long: "pr", description: "PR URL" }),
    dependsOn: option({ type: optional(string), long: "depends-on", description: "Set dependency IDs (comma-separated, replaces existing)" }),
    unclaim: flag({ long: "unclaim", description: "Clear the claimed_by field" }),
  },
  handler: (args) => {
    const id = resolveId(args.id);
    const task = loadTask(id);
    if (!task) {
      console.error(`Task "${id}" not found.`);
      process.exit(1);
    }
    if (args.title !== undefined) task.title = args.title;
    if (args.description !== undefined) task.description = args.description;
    if (args.branch !== undefined) task.branch = args.branch;
    if (args.worktree !== undefined) task.worktree = args.worktree;
    if (args.pr !== undefined) task.pr = args.pr;
    if (args.dependsOn !== undefined) {
      task.dependencies = args.dependsOn ? args.dependsOn.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
    if (args.unclaim) { task.claimedBy = null; task.claimedAt = null; }
    saveTask(task);
    ok(`updated ${bold(task.id)}`);
  },
});

// ── gs-agentic state task cancel ─────────────────────────────────────────────

const cancel = command({
  name: "cancel",
  description: "Cancel a task",
  args: {
    id: option({ type: optional(string), long: "id", short: "i", description: "Task ID (defaults to last-touched)" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name" }),
  },
  handler: (args) => {
    try {
      const id = resolveId(args.id);
      const task = transitionTask(id, "cancelled", {
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
    epic: option({ type: optional(string), long: "epic", description: "Filter by epic ID" }),
    all: flag({ long: "all", description: "Show tasks across all repos" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const epicFilter = args.epic;
    let tasks = listTasks({ epic: epicFilter ?? undefined, all: args.all, lean: args.json });

    if (args.phase) {
      tasks = tasks.filter((t) => t.phase === args.phase);
    }

    if (args.json) {
      console.log(JSON.stringify(tasks));
      return;
    }

    if (tasks.length === 0) {
      console.log(dim("No tasks found."));
      return;
    }

    for (const t of tasks) {
      const icon = isTerminal(t.phase) ? (t.phase === "done" ? "✓" : "✗") : "●";
      console.log(`  ${icon} ${bold(t.id)} ${t.title} ${dim(`[${t.phase}]`)}${t.branch ? dim(` ${t.branch}`) : ""}${t.claimedBy ? yellow(` ← ${t.claimedBy}`) : ""}`);
    }
  },
});

// ── gs-agentic state epic create ─────────────────────────────────────────────

const epicCreate = command({
  name: "create",
  description: "Create a new epic",
  args: {
    title: option({ type: string, long: "title", short: "t", description: "Epic title" }),
    description: option({ type: optional(string), long: "description", short: "d", description: "Epic description" }),
    phase: option({ type: optional(string), long: "phase", description: "Initial phase (default: understand)" }),
  },
  handler: (args) => {
    const phase = (args.phase as Phase) ?? undefined;
    if (phase && !PHASES.includes(phase)) {
      console.error(`Invalid phase: "${phase}". Valid: ${PHASES.join(", ")}`);
      process.exit(1);
    }
    const epic = createEpic({
      title: args.title,
      description: args.description ?? "",
      phase,
    });
    ok(`created epic ${bold(epic.id)}: ${epic.title}`);
    console.log(epic.id);
  },
});

// ── gs-agentic state epic show ───────────────────────────────────────────────

const epicShow = command({
  name: "show",
  description: "Show epic details",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Epic ID" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const epic = loadEpic(args.id);
    if (!epic) {
      console.error(`Epic "${args.id}" not found.`);
      process.exit(1);
    }

    // Derive phase from children
    const derivedPhase = deriveEpicPhase(args.id);
    const tasks = listTasks({ epic: args.id, lean: args.json });

    if (args.json) {
      console.log(JSON.stringify({ id: epic.id, title: epic.title, phase: derivedPhase, tasks }));
      return;
    }

    const phaseColor = {
      understand: cyan,
      design: (s: string) => `\x1b[35m${s}\x1b[0m`,
      implement: yellow,
      verify: cyan,
      ship: green,
      done: dim,
      cancelled: dim,
    }[derivedPhase] ?? dim;

    console.log(`${bold(epic.id)}: ${epic.title}`);
    console.log(`  phase: ${phaseColor(derivedPhase)}`);
    if (epic.description) console.log(`  desc:  ${epic.description}`);
    if (epic.plan) console.log(`  plan: ${epic.plan}`);
    if (tasks.length > 0) {
      console.log(`  tasks: ${tasks.length}`);
      for (const t of tasks) {
        const icon = isTerminal(t.phase) ? (t.phase === "done" ? "✓" : "✗") : "●";
        console.log(`    ${icon} ${bold(t.id)} ${t.title} ${dim(`[${t.phase}]`)}`);
      }
    }
  },
});

// ── gs-agentic state epic list ───────────────────────────────────────────────

const epicList = command({
  name: "list",
  description: "List epics",
  args: {
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const epics = listEpics();

    if (args.json) {
      const enriched = epics.map((e) => ({
        id: e.id,
        title: e.title,
        phase: deriveEpicPhase(e.id),
        taskCount: listTasks({ epic: e.id, lean: true }).length,
      }));
      console.log(JSON.stringify(enriched));
      return;
    }

    if (epics.length === 0) {
      console.log(dim("No epics found."));
      return;
    }

    for (const e of epics) {
      const derivedPhase = deriveEpicPhase(e.id);
      const tasks = listTasks({ epic: e.id });
      const icon = isTerminal(derivedPhase) ? (derivedPhase === "done" ? "✓" : "✗") : "●";
      console.log(`  ${icon} ${bold(e.id)} ${e.title} ${dim(`[${derivedPhase}]`)} ${dim(`(${tasks.length} tasks)`)}`);
    }
  },
});

// ── gs-agentic state task note ───────────────────────────────────────────────

const note = command({
  name: "note",
  description: "Add a note to a task",
  args: {
    id: option({ type: optional(string), long: "id", short: "i", description: "Task ID (defaults to last-touched)" }),
    body: option({ type: string, long: "body", short: "b", description: "Note content" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name" }),
  },
  handler: (args) => {
    const id = resolveId(args.id);
    const n = addTaskNote({ taskId: id, body: args.body, actor: args.actor ?? undefined });
    ok(`note ${bold(n.id)} added to ${bold(id)}`);
  },
});

// ── gs-agentic state task notes ──────────────────────────────────────────────

const notes = command({
  name: "notes",
  description: "List notes for a task",
  args: {
    id: option({ type: optional(string), long: "id", short: "i", description: "Task ID (defaults to last-touched)" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const id = resolveId(args.id);
    const items = loadTaskNotes(id);
    if (args.json) {
      console.log(JSON.stringify(items));
      return;
    }
    if (items.length === 0) {
      console.log(dim("No notes."));
      return;
    }
    for (const n of items) {
      console.log(`  ${bold(n.id)} ${dim(n.createdAt)} ${dim(`[${n.actor}]`)} ${n.body}`);
    }
  },
});

// ── Export subcommands ───────────────────────────────────────────────

const stateEpic = subcommands({
  name: "epic",
  description: "Epic management",
  cmds: {
    create: epicCreate,
    show: epicShow,
    list: epicList,
  },
});

export const stateTask = subcommands({
  name: "task",
  description: "Task management",
  cmds: {
    create,
    show,
    current,
    next,
    transition,
    update,
    cancel,
    list,
    note,
    notes,
  },
});

export { stateEpic };
