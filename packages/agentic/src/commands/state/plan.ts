import { command, subcommands, option, flag, optional, string } from "cmd-ts";
import { loadTask, loadEpic, loadPlan, savePlan, savePlanFromFile, listPlanVersions, createTask, saveTask, parseSyncInput, syncCreateEpicWithTasks } from "../../lib/state.js";
import { loadFeedback, resolveFeedback as resolveFeedbackFile } from "../../lib/plan-feedback.js";
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
    stdin: flag({ long: "stdin", description: "Read content from stdin" }),
  },
  handler: async (args) => {
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
        return;
      }
    } else if (args.content) {
      ver = savePlan(args.id, args.content);
    } else if (args.stdin) {
      if (process.stdin.isTTY) {
        console.error("--stdin requires piped input. Use: cat plan.md | gs-agentic state plan set --id <id> --stdin");
        process.exit(1);
        return;
      }
      const sourceCount = [args.file, args.content].filter(Boolean).length;
      if (sourceCount > 0) {
        console.error("Provide only one of --file, --content, or --stdin.");
        process.exit(1);
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, "utf-8"));
        }
        const text = Buffer.concat(chunks).toString("utf-8");
        if (!text.trim()) {
          console.error("No content received on stdin.");
          process.exit(1);
          return;
        }
        ver = savePlan(args.id, text);
      } catch (e: any) {
        console.error(`Failed to read stdin: ${e.message}`);
        process.exit(1);
        return;
      }
    } else {
      console.error("Provide --file, --content, or --stdin.");
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
      phase: "design",
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

// ── gs-agentic state plan feedback ────────────────────────────────────────

const feedback = command({
  name: "feedback",
  description: "Display plan feedback for a task or epic",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task or Epic ID" }),
  },
  handler: (args) => {
    const content = loadFeedback(args.id);
    if (!content) {
      console.log(dim(`No feedback for "${args.id}".`));
      return;
    }
    console.log(content);
  },
});

// ── gs-agentic state plan resolve-feedback ────────────────────────────────

const resolveFeedback = command({
  name: "resolve-feedback",
  description: "Archive plan feedback as resolved for a task or epic",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task or Epic ID" }),
  },
  handler: (args) => {
    resolveFeedbackFile(args.id);
    ok(`feedback resolved for ${bold(args.id)}`);
  },
});

// ── gs-agentic state plan sync ──────────────────────────────────────────────

const sync = command({
  name: "sync",
  description: "Atomically create epic + tasks from stdin",
  args: {
    stdin: flag({ long: "stdin", description: "Read task definitions from stdin" }),
    actor: option({ type: optional(string), long: "actor", description: "Actor name" }),
  },
  handler: async (args) => {
    if (!args.stdin) {
      console.error("--stdin is required. Pipe input: echo '...' | gs-agentic state plan sync --stdin");
      process.exit(1);
    }
    if (process.stdin.isTTY) {
      console.error("--stdin requires piped input.");
      process.exit(1);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, "utf-8"));
    }
    const text = Buffer.concat(chunks).toString("utf-8");

    let input;
    try {
      input = parseSyncInput(text);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
      return;
    }

    let result;
    try {
      result = syncCreateEpicWithTasks(input, { actor: args.actor ?? undefined });
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
      return;
    }

    console.log(JSON.stringify(result));
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
    sync,
    history,
    feedback,
    "resolve-feedback": resolveFeedback,
  },
});
