import { command, option, string } from "cmd-ts";
import { loadTask } from "../../lib/state.js";
import { bold, dim } from "../../lib/fmt.js";

// ── gs-agentic state log <id> ────────────────────────────────────────────────

export const stateLog = command({
  name: "log",
  description: "Show phase transition history for a task",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
  },
  handler: (args) => {
    const task = loadTask(args.id);
    if (!task) {
      console.error(`Task "${args.id}" not found.`);
      process.exit(1);
    }

    console.log(`${bold(task.id)}: ${task.title}\n`);

    if (task.transitions.length === 0) {
      console.log(dim("  No transitions recorded."));
      return;
    }

    for (const t of task.transitions) {
      const ts = new Date(t.timestamp).toLocaleString();
      console.log(`  ${dim(ts)}  →  ${bold(t.phase)}  ${dim(`(${t.actor})`)}`);
    }
  },
});
