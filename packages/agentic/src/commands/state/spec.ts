import { command, subcommands, option, optional, string } from "cmd-ts";
import { loadTask, loadPlan, savePlan, savePlanFromFile, createTask, saveTask } from "../../lib/state.js";
import { ok, bold } from "../../lib/fmt.js";

// ── gs-agentic state spec show ───────────────────────────────────────────────

const show = command({
  name: "show",
  description: "Display spec content for a task",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
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

// ── gs-agentic state spec set ────────────────────────────────────────────────

const set = command({
  name: "set",
  description: "Write spec content for a task",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
    file: option({ type: optional(string), long: "file", short: "f", description: "Read content from file" }),
    content: option({ type: optional(string), long: "content", short: "c", description: "Spec content string" }),
  },
  handler: (args) => {
    const task = loadTask(args.id);
    if (!task) {
      console.error(`Task "${args.id}" not found.`);
      process.exit(1);
    }

    if (args.file) {
      try {
        savePlanFromFile(args.id, args.file);
      } catch (e: any) {
        console.error(e.message);
        process.exit(1);
      }
    } else if (args.content) {
      savePlan(args.id, args.content);
    } else {
      console.error("Provide --file or --content.");
      process.exit(1);
    }

    ok(`spec saved for ${bold(args.id)}`);
  },
});

// ── gs-agentic state spec add-task ──────────────────────────────────────────

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

// ── Export subcommands ───────────────────────────────────────────────

export const stateSpec = subcommands({
  name: "spec",
  description: "Spec management",
  cmds: {
    show,
    set,
    "add-task": addTask,
  },
});
