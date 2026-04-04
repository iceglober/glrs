import { command, option, string } from "cmd-ts";
import { loadTask, saveTask } from "../../lib/state.js";
import { ok, bold } from "../../lib/fmt.js";

// ── gs-agentic state qa report ───────────────────────────────────────────────

export const qaReport = command({
  name: "report",
  description: "Record a QA result for a task",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Task ID" }),
    status: option({ type: string, long: "status", short: "s", description: "pass or fail" }),
    summary: option({ type: string, long: "summary", short: "m", description: "QA summary" }),
  },
  handler: (args) => {
    if (args.status !== "pass" && args.status !== "fail") {
      console.error(`Status must be "pass" or "fail", got "${args.status}".`);
      process.exit(1);
    }

    const task = loadTask(args.id);
    if (!task) {
      console.error(`Task "${args.id}" not found.`);
      process.exit(1);
    }

    task.qaResult = {
      status: args.status as "pass" | "fail",
      summary: args.summary,
      timestamp: new Date().toISOString(),
    };
    saveTask(task);

    const icon = args.status === "pass" ? "✓" : "✗";
    ok(`QA ${icon} ${bold(args.id)}: ${args.summary}`);
  },
});
