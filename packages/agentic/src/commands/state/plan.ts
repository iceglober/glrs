import { command, subcommands, option, flag, optional, string } from "cmd-ts";
import { loadTask, loadEpic, loadPlan, savePlan, savePlanFromFile, listPlanVersions, createTask, saveTask } from "../../lib/state.js";
import { ok, bold, dim } from "../../lib/fmt.js";

// ── gs-agentic state plan show ──────────────────────────────────────────────

const show = command({
  name: "show",
  description: "Display plan content for a task or epic",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task or Epic ID" }),
  },
  handler: (args) => {
    const plan = loadPlan(args.id);
    if (!plan) {
      console.error(`No plan found for "${args.id}".`);
      process.exit(1);
    }
    console.log(plan);
  },
});

// ── gs-agentic state plan set ───────────────────────────────────────────────

const set = command({
  name: "set",
  description: "Write plan content for a task or epic",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task or Epic ID" }),
    file: option({ type: optional(string), long: "file", short: "f", description: "Read content from file" }),
    content: option({ type: optional(string), long: "content", short: "c", description: "Plan content string" }),
  },
  handler: (args) => {
    // Verify entity exists (task or epic)
    const task = loadTask(args.id);
    const epic = !task ? loadEpic(args.id) : null;
    if (!task && !epic) {
      console.error(`"${args.id}" not found (checked tasks and epics).`);
      process.exit(1);
    }

    let ver: number;
    if (args.file) {
      try {
        ver = savePlanFromFile(args.id, args.file);
      } catch (e: any) {
        console.error(e.message);
        process.exit(1);
        return; // unreachable, but satisfies TS
      }
    } else if (args.content) {
      ver = savePlan(args.id, args.content);
    } else {
      console.error("Provide --file or --content.");
      process.exit(1);
      return;
    }

    ok(`plan v${ver} saved for ${bold(args.id)}`);
  },
});

// ── gs-agentic state plan add-task ─────────────────────────────────────────

const addTask = command({
  name: "add-task",
  description: "Add a task to an epic",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Epic ID" }),
    title: option({ type: string, long: "title", short: "t", description: "Task title" }),
    dependsOn: option({ type: optional(string), long: "depends-on", description: "Comma-separated dependency task IDs" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name" }),
  },
  handler: (args) => {
    const child = createTask({
      title: args.title,
      epic: args.id,
      phase: "implement",
      actor: args.actor ?? "cli",
    });

    if (args.dependsOn) {
      child.dependencies = args.dependsOn.split(",").map((s) => s.trim());
      saveTask(child);
    }

    ok(`task ${bold(child.id)}: ${child.title} (under ${args.id})`);
    console.log(child.id);
  },
});

// ── gs-agentic state plan history ──────────────────────────────────────────

const history = command({
  name: "history",
  description: "List plan versions for a task or epic",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task or Epic ID" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const versions = listPlanVersions(args.id);

    if (args.json) {
      console.log(JSON.stringify({ id: args.id, versions }));
      return;
    }

    if (versions.length === 0) {
      console.log(dim(`No plan versions for "${args.id}".`));
      return;
    }

    console.log(`${bold(args.id)} — ${versions.length} version(s)`);
    for (const v of versions) {
      console.log(`  v${v}`);
    }
  },
});

// ── Export subcommands ───────────────────────────────────────────────

export const statePlan = subcommands({
  name: "plan",
  description: "Plan management",
  cmds: {
    show,
    set,
    "add-task": addTask,
    history,
  },
});
