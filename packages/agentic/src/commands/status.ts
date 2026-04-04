import { command, flag } from "cmd-ts";
import { listTasks, deriveEpicPhase, dependenciesMet, isTerminal, loadPipeline, type Task, type Phase } from "../lib/state.js";
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

function formatTask(task: Task, indent: number, allTasks: Task[]): void {
  const prefix = "  ".repeat(indent);
  const color = phaseColor[task.phase] ?? dim;
  const icon = phaseIcon[task.phase] ?? "●";
  const blocked = !isTerminal(task.phase) && !dependenciesMet(task) ? red(" [blocked]") : "";

  let line = `${prefix}${color(icon)} ${bold(task.id)} ${task.title} ${dim(`[${task.phase}]`)}`;
  if (task.branch) line += dim(` ${task.branch}`);
  if (task.pr) line += ` ${dim(task.pr)}`;
  line += blocked;
  console.log(line);

  // Show pipeline progress for non-terminal, non-epic tasks
  if (!isTerminal(task.phase) && task.children.length === 0) {
    const pipeline = loadPipeline(task.id);
    if (pipeline) {
      const completed = pipeline.completedSkills;
      const next = pipeline.nextSkill;
      if (completed.length > 0 || next) {
        let detail = `${prefix}  `;
        if (completed.length > 0) {
          detail += dim(`done: ${completed.join(", ")}`);
        }
        if (next) {
          detail += (completed.length > 0 ? dim("  ") : "") + yellow(`next: /${next}`);
        }
        console.log(detail);
      }
    }

    // Show resume hint for stalled tasks
    if (task.worktree) {
      console.log(`${prefix}  ${dim(`resume: cd ${task.worktree} && gs-agentic start`)}`);
    }
  }

  // Print children indented
  if (task.children.length > 0) {
    for (const childId of task.children) {
      const child = allTasks.find((t) => t.id === childId);
      if (child) formatTask(child, indent + 1, allTasks);
    }
  }
}

export const status = command({
  name: "status",
  description: "Show all tasks and their progress",
  args: {
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

    if (args.json) {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }

    if (tasks.length === 0) {
      console.log(dim("No tasks. Run `gs-agentic start` to begin."));
      return;
    }

    // Show top-level tasks (no parent), with children nested
    const topLevel = tasks.filter((t) => !t.parent);
    for (const task of topLevel) {
      formatTask(task, 0, tasks);
    }
  },
});
