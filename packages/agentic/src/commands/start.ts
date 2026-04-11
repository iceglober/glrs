import { command, positional, flag, optional, string, option } from "cmd-ts";
import { createTask, findTaskByWorktree, findTaskByBranch, loadTask, listTasks, isTerminal, loadPipeline, saveTask, type Task } from "../lib/state.js";
import { runPipeline } from "../lib/pipeline.js";
import { gitSafe } from "../lib/git.js";
import { bold, dim, info, warn, yellow } from "../lib/fmt.js";
import { slugify } from "../lib/slug.js";
import { ensureWorktree } from "../lib/worktree.js";
import * as readline from "node:readline";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Find stalled tasks (non-terminal, with a worktree assigned). */
function findStalledTasks(): Task[] {
  return listTasks().filter((t) => !isTerminal(t.phase) && t.worktree);
}

export const start = command({
  name: "start",
  description: "Start or resume a task pipeline",
  args: {
    description: positional({
      type: optional(string),
      displayName: "description",
      description: "What are you working on?",
    }),
    quick: flag({ long: "quick", short: "q", description: "Skip design phases (bugs/small features)" }),
    id: option({ type: optional(string), long: "id", short: "i", description: "Resume a specific task by ID" }),
  },
  handler: async (args) => {
    // 1. Direct resume by ID (--id t1)
    if (args.id) {
      const task = loadTask(args.id);
      if (!task) {
        console.error(`Task "${args.id}" not found.`);
        process.exit(1);
      }
      if (isTerminal(task.phase)) {
        info(`task ${bold(task.id)} is already ${task.phase}.`);
        return;
      }
      info(`resuming ${bold(task.id)}: ${task.title} [${task.phase}]`);
      await runPipeline(task);
      return;
    }

    // 2. Check if we're in a worktree with an active task (R-11)
    const cwd = process.cwd();
    let task = findTaskByWorktree(cwd);

    // Also try matching by current branch
    if (!task) {
      const branch = gitSafe("branch", "--show-current");
      if (branch) {
        task = findTaskByBranch(branch);
      }
    }

    if (task) {
      if (isTerminal(task.phase)) {
        info(`task ${bold(task.id)} is already ${task.phase}.`);
        return;
      }
      info(`resuming ${bold(task.id)}: ${task.title} [${task.phase}]`);
      await runPipeline(task);
      return;
    }

    // 3. No active task on this branch — check for stalled tasks
    if (!args.description) {
      const stalled = findStalledTasks();
      if (stalled.length > 0) {
        console.log(`\n${bold("Stalled tasks:")}\n`);
        for (let i = 0; i < stalled.length; i++) {
          const t = stalled[i];
          const pipeline = loadPipeline(t.id);
          const next = pipeline?.nextSkill ? yellow(` (next: /${pipeline.nextSkill})`) : "";
          console.log(`  ${bold(String(i + 1))}. ${bold(t.id)}: ${t.title} ${dim(`[${t.phase}]`)}${next}`);
        }
        console.log();

        if (stalled.length === 1) {
          const answer = await ask(`Resume ${bold(stalled[0].id)}? [y/n] `);
          if (answer.toLowerCase().startsWith("y")) {
            await runPipeline(stalled[0]);
            return;
          }
        } else {
          const answer = await ask(`Resume which task? [1-${stalled.length}, or n to create new] `);
          const num = parseInt(answer, 10);
          if (num >= 1 && num <= stalled.length) {
            await runPipeline(stalled[num - 1]);
            return;
          }
        }

        // User declined — fall through to create new
      }

      // No stalled tasks or user declined — prompt for description
      const desc = await ask("What are you working on? ");
      if (!desc) {
        warn("No description provided. Exiting.");
        process.exit(0);
      }
      args.description = desc;
    }

    // 4. Create the task
    const phase = args.quick ? "implement" : "understand";
    task = createTask({
      title: args.description!,
      phase,
      actor: "gs-agentic start",
    });

    info(`created ${bold(task.id)}: ${task.title}`);

    // 5. For --quick, create worktree immediately (BR-07)
    // Branch from current HEAD so worktree has the latest code
    if (args.quick) {
      const slug = slugify(`${task.id}-${task.title}`);
      const currentBranch = gitSafe("rev-parse", "--abbrev-ref", "HEAD") ?? undefined;
      const wtPath = ensureWorktree(slug, currentBranch);
      task.branch = slug;
      task.worktree = wtPath;
      saveTask(task);
    }

    // 6. Run the pipeline
    await runPipeline(task);
  },
});
