import { command, flag } from "cmd-ts";
import { findReadyTasks, listEpics, isTerminal, type Task } from "../lib/state.js";
import { bold, dim, cyan, yellow, green } from "../lib/fmt.js";

export const ready = command({
  name: "ready",
  description: "Show tasks that are ready to work on (deps met, non-terminal)",
  args: {
    json: flag({ long: "json", description: "Output as JSON" }),
    all: flag({ long: "all", description: "Show tasks across all repos" }),
  },
  handler: (args) => {
    const tasks = findReadyTasks({ all: args.all });

    if (args.json) {
      // Group by epic
      const grouped: Record<string, { epic: string | null; tasks: Task[] }> = {};
      for (const t of tasks) {
        const key = t.epic ?? "__standalone__";
        if (!grouped[key]) grouped[key] = { epic: t.epic, tasks: [] };
        grouped[key].tasks.push(t);
      }
      console.log(JSON.stringify(Object.values(grouped), null, 2));
      return;
    }

    if (tasks.length === 0) {
      console.log(dim("Nothing ready."));
      return;
    }

    // Group by epic for display
    const epics = listEpics();
    const epicMap = new Map(epics.map((e) => [e.id, e]));

    const byEpic = new Map<string | null, Task[]>();
    for (const t of tasks) {
      const key = t.epic;
      if (!byEpic.has(key)) byEpic.set(key, []);
      byEpic.get(key)!.push(t);
    }

    const phaseColor = (phase: string) => {
      switch (phase) {
        case "understand": return cyan(phase);
        case "design": return `\x1b[35m${phase}\x1b[0m`;
        case "implement": return yellow(phase);
        case "verify": return cyan(phase);
        case "ship": return green(phase);
        default: return dim(phase);
      }
    };

    for (const [epicId, epicTasks] of byEpic) {
      if (epicId) {
        const epic = epicMap.get(epicId);
        console.log(`${bold(epicId)}: ${epic?.title ?? "Unknown epic"}`);
      } else {
        if (byEpic.size > 1) console.log(bold("Standalone"));
      }

      for (const t of epicTasks) {
        console.log(`  ● ${bold(t.id)} ${t.title} ${dim(`[${phaseColor(t.phase)}]`)}${t.branch ? dim(` ${t.branch}`) : ""}`);
      }
    }
  },
});
