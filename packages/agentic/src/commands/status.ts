import { command, flag, option, optional, string } from "cmd-ts";
import { listTasks, listEpics, deriveEpicPhase, dependenciesMet, isTerminal, epicProgress, type Task, type Phase, type Epic } from "../lib/state.js";
import { bold, dim, cyan, green, yellow, red, progressBar } from "../lib/fmt.js";

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
  if (task.claimedBy) line += yellow(` ← ${task.claimedBy}`);
  line += blocked;
  console.log(line);

  if (!isTerminal(task.phase) && task.worktree) {
    console.log(`${prefix}  ${dim(`worktree: ${task.worktree}`)}`);
  }
}

/**
 * Produce a single-line compact summary of each epic.
 * Format: "e1: Title [3/7 done, 2 ready, 1 blocked] | e2: ..."
 */
export function compactSummary(epicFilter?: string): string {
  let epics = listEpics();
  if (epicFilter) epics = epics.filter((e) => e.id === epicFilter);

  if (epics.length === 0) return "No epics";

  return epics
    .map((e) => {
      const p = epicProgress(e.id);
      const parts: string[] = [`${p.done}/${p.total} done`];
      if (p.ready > 0) parts.push(`${p.ready} ready`);
      if (p.blocked > 0) parts.push(`${p.blocked} blocked`);
      if (p.inProgress > 0) parts.push(`${p.inProgress} in-progress`);
      return `${e.id}: ${e.title} [${parts.join(", ")}]`;
    })
    .join(" | ");
}

export const status = command({
  name: "status",
  description: "Show all tasks and their progress",
  args: {
    json: flag({ long: "json", description: "Output as JSON" }),
    compact: flag({ long: "compact", description: "Single-line summary (token-efficient)" }),
    epic: option({ type: optional(string), long: "epic", short: "e", description: "Filter to a single epic" }),
  },
  handler: (args) => {
    if (args.compact) {
      console.log(compactSummary(args.epic));
      return;
    }

    let epics = listEpics();
    if (args.epic) epics = epics.filter((e) => e.id === args.epic);
    const allTasks = listTasks({ epic: args.epic ?? undefined });

    if (args.json) {
      const data = epics.map((e) => ({
        ...e,
        phase: deriveEpicPhase(e.id),
        progress: epicProgress(e.id),
        tasks: allTasks.filter((t) => t.epic === e.id),
      }));
      const standalone = args.epic ? [] : allTasks.filter((t) => !t.epic);
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
      const progress = epicProgress(epic.id);

      console.log(`${color(icon)} ${bold(epic.id)} ${epic.title} ${dim(`[${derivedPhase}]`)} ${dim(`(${tasks.length} tasks)`)}`);
      console.log(`  ${progressBar(progress.done + progress.cancelled, progress.total)}`);
      for (const task of tasks) {
        formatTask(task, 1);
      }
    }

    // Show standalone tasks
    const standalone = args.epic ? [] : allTasks.filter((t) => !t.epic);
    if (standalone.length > 0) {
      if (epics.length > 0) console.log(""); // separator
      for (const task of standalone) {
        formatTask(task, 0);
      }
    }
  },
});
