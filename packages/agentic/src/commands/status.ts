import { command, flag } from "cmd-ts";
import { listTasks, listEpics, deriveEpicPhase, dependenciesMet, isTerminal, type Task, type Phase, type Epic } from "../lib/state.js";
import { bold, dim, cyan, green, yellow, red } from "../lib/fmt.js";

const phaseColor: Record<Phase, (s: string) => string> = {
  understand: cyan,
  design: (s: string) => `\x1b[35m${s}\x1b[0m`, // purple
  implement: yellow,
  verify: cyan,
  ship: green,
  done: dim,
  cancelled: (s: string) => `\x1b[9m${s}\x1b[0m`, // strikethrough
};

const phaseIcon: Record<Phase, string> = {
  understand: "?",
  design: "◇",
  implement: "⚙",
  verify: "✔",
  ship: "↑",
  done: "✓",
  cancelled: "✗",
};

function formatTask(task: Task, indent: number): void {
  const prefix = "  ".repeat(indent);
  const color = phaseColor[task.phase] ?? dim;
  const icon = phaseIcon[task.phase] ?? "●";
  const blocked = !isTerminal(task.phase) && !dependenciesMet(task) ? red(" [blocked]") : "";

  let line = `${prefix}${color(icon)} ${bold(task.id)} ${task.title} ${dim(`[${task.phase}]`)}`;
  if (task.branch) line += dim(` ${task.branch}`);
  if (task.pr) line += ` ${dim(task.pr)}`;
  line += blocked;
  console.log(line);

  if (!isTerminal(task.phase) && task.worktree) {
    console.log(`${prefix}  ${dim(`worktree: ${task.worktree}`)}`);
  }
}

export const status = command({
  name: "status",
  description: "Show all tasks and their progress",
  args: {
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const epics = listEpics();
    const allTasks = listTasks();

    if (args.json) {
      const data = epics.map((e) => ({
        ...e,
        phase: deriveEpicPhase(e.id),
        tasks: allTasks.filter((t) => t.epic === e.id),
      }));
      const standalone = allTasks.filter((t) => !t.epic);
      console.log(JSON.stringify({ epics: data, standalone }));
      return;
    }

    if (epics.length === 0 && allTasks.length === 0) {
      console.log(dim("No tasks. Use /gs-deep-plan to create an epic with tasks."));
      return;
    }

    // Show epics with their tasks
    for (const epic of epics) {
      const derivedPhase = deriveEpicPhase(epic.id);
      const color = phaseColor[derivedPhase] ?? dim;
      const icon = phaseIcon[derivedPhase] ?? "●";
      const tasks = allTasks.filter((t) => t.epic === epic.id);

      console.log(`${color(icon)} ${bold(epic.id)} ${epic.title} ${dim(`[${derivedPhase}]`)} ${dim(`(${tasks.length} tasks)`)}`);
      for (const task of tasks) {
        formatTask(task, 1);
      }
    }

    // Show standalone tasks
    const standalone = allTasks.filter((t) => !t.epic);
    if (standalone.length > 0) {
      if (epics.length > 0) console.log(""); // separator
      for (const task of standalone) {
        formatTask(task, 0);
      }
    }
  },
});
