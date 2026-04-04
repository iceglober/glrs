import {
  loadTask,
  loadPipeline,
  savePipeline,
  transitionTask,
  type Task,
  type Phase,
  type PipelineState,
} from "./state.js";
import { runSession, SessionInterrupted } from "./session-runner.js";
import { gitRoot, gitSafe, gitInSafe } from "./git.js";
import { ensureWorktree } from "./worktree.js";
import { slugify } from "./slug.js";
import { ok, info, warn, bold, dim, red } from "./fmt.js";
import * as readline from "node:readline";

// ── Skill definitions per phase ──────────────────────────────────────

const DESIGN_SKILLS = ["spec-make", "spec-enrich", "spec-refine", "spec-lab", "spec-review"];

function phaseSkills(phase: Phase): string[] {
  switch (phase) {
    case "understand":
      return ["think"];
    case "design":
      return DESIGN_SKILLS;
    case "implement":
      return ["work"];
    case "verify":
      return ["qa"];
    case "ship":
      return ["ship"];
    default:
      return [];
  }
}

// ── User prompts ─────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} [y/n] `);
  return answer.toLowerCase().startsWith("y");
}

// ── Build the prompt for a skill session ─────────────────────────────

function buildSkillPrompt(skill: string, task: Task): string {
  const lines: string[] = [];

  // Inject task context directly into the prompt
  lines.push(`## Task Context`);
  lines.push(`- Task ID: ${task.id}`);
  lines.push(`- Title: ${task.title}`);
  if (task.description) lines.push(`- Description: ${task.description}`);
  lines.push(`- Phase: ${task.phase}`);
  if (task.branch) lines.push(`- Branch: ${task.branch}`);
  if (task.worktree) lines.push(`- Worktree: ${task.worktree}`);
  if (task.spec) lines.push(`- Spec file: ${task.spec}`);
  if (task.pr) lines.push(`- PR: ${task.pr}`);

  lines.push("");
  lines.push(`Use \`gs-agentic state task show --id ${task.id} --json\` for full task details. Use \`gs-agentic state spec show --id ${task.id}\` to read the spec. Use \`gs-agentic state task update --id ${task.id} --pr <url>\` to record a PR URL after creating one.`);
  lines.push("");
  lines.push(`/${skill} ${task.id}: ${task.title}`);

  return lines.join("\n");
}

// ── Determine the working directory for a phase ──────────────────────

function sessionCwd(task: Task, phase: Phase): string {
  if (task.worktree && (phase === "implement" || phase === "verify" || phase === "ship")) {
    return task.worktree;
  }
  return gitRoot();
}

// ── Check if a worktree has commits ahead of main ────────────────────

function hasCommitsAhead(worktree: string): boolean {
  const log = gitInSafe(worktree, "log", "HEAD", "--not", "--remotes=origin/main", "--oneline");
  // Also check for any diff against the base branch
  if (log && log.trim().length > 0) return true;
  const diff = gitInSafe(worktree, "diff", "--stat");
  return diff !== null && diff.trim().length > 0;
}

// ── Test-file gate ──────────────────────────────────────────────────

function hasTestChanges(worktree: string): boolean {
  const diff = gitInSafe(worktree, "diff", "--name-only", "origin/main...HEAD");
  if (!diff) return false;
  return diff.split("\n").some(f => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"));
}

function buildTestRetryPrompt(task: Task): string {
  const lines: string[] = [];
  lines.push(`You already implemented the feature for this task. Now you need to add tests.`);
  lines.push(``);
  lines.push(`## Task: ${task.id}: ${task.title}`);
  lines.push(``);
  lines.push(`## What to do`);
  lines.push(``);
  lines.push(`1. Read the diff to understand what was implemented: \`git diff origin/main...HEAD\``);
  lines.push(`2. Create a test file for the changed module(s)`);
  lines.push(`3. Write tests that verify the new behavior works correctly`);
  lines.push(`4. Run \`bun test\` to confirm all tests pass`);
  lines.push(`5. Run \`bun run typecheck\` to confirm no errors`);
  lines.push(``);
  lines.push(`Do NOT modify the implementation — only add tests.`);
  lines.push(`Name the test file \`<module>.test.ts\` next to the source file.`);
  return lines.join("\n");
}

// ── Pipeline orchestrator ────────────────────────────────────────────

export async function runPipeline(task: Task): Promise<void> {
  try {
    await _runPipeline(task);
  } catch (e) {
    if (e instanceof SessionInterrupted) {
      // Clear the ^C from the terminal line
      process.stdout.write("\r\x1b[K");
      warn(`pipeline interrupted. Run ${bold("gs-agentic start")} to resume.`);
      return;
    }
    throw e;
  }
}

async function _runPipeline(task: Task): Promise<void> {
  info(`pipeline: ${bold(task.id)} — ${task.title}`);

  while (true) {
    // Reload task to get latest state
    const current = loadTask(task.id);
    if (!current) {
      warn(`task ${task.id} not found, aborting pipeline.`);
      return;
    }

    // Terminal?
    if (current.phase === "done" || current.phase === "cancelled") {
      ok(`${bold(current.id)} is ${current.phase}. Pipeline complete.`);
      return;
    }

    // If epic with children, run children sequentially
    if (current.children.length > 0) {
      await runEpicChildren(current);
      return;
    }

    const skills = phaseSkills(current.phase);
    if (skills.length === 0) {
      ok(`no skills for phase "${current.phase}", advancing...`);
      advancePhase(current);
      continue;
    }

    // Load or create pipeline state
    let pipeline = loadPipeline(current.id);
    if (!pipeline || pipeline.currentPhase !== current.phase) {
      pipeline = {
        taskId: current.id,
        currentPhase: current.phase,
        completedSkills: [],
        skippedSkills: [],
        nextSkill: skills[0],
        startedAt: new Date().toISOString(),
      };
      savePipeline(pipeline);
    }

    // Ensure worktree exists before implement phase
    // Branch from current HEAD (not main) so worktree has the latest code
    if (current.phase === "implement" && !current.worktree) {
      const slug = slugify(`${current.id}-${current.title}`);
      const currentBranch = gitSafe("rev-parse", "--abbrev-ref", "HEAD") ?? undefined;
      const wtPath = ensureWorktree(slug, currentBranch);
      const { saveTask } = await import("./state.js");
      const t = loadTask(current.id)!;
      t.branch = slug;
      t.worktree = wtPath;
      saveTask(t);
    }

    // Run remaining skills (with one retry on failure)
    let phaseSucceeded = true;
    for (const skill of skills) {
      if (pipeline.completedSkills.includes(skill) || pipeline.skippedSkills.includes(skill)) {
        continue;
      }

      const succeeded = await runSkillWithRetry(skill, current, pipeline);
      if (!succeeded) {
        phaseSucceeded = false;
        break;
      }

      // Special: spec-refine can run multiple rounds (BR-11)
      if (skill === "spec-refine" && current.phase === "design") {
        const again = await confirm("Run another refinement round?");
        if (again) {
          pipeline.completedSkills = pipeline.completedSkills.filter((s) => s !== "spec-refine");
          pipeline.nextSkill = "spec-refine";
          savePipeline(pipeline);
        }
      }
    }

    if (!phaseSucceeded) return;

    // After implement: verify that work was actually produced
    if (current.phase === "implement" && current.worktree) {
      if (!hasCommitsAhead(current.worktree)) {
        warn("implement phase produced no changes.");
        warn(`task ${bold(current.id)} remains in implement. Run ${bold("gs-agentic start")} to retry.`);
        savePipeline({
          taskId: current.id,
          currentPhase: "implement",
          completedSkills: [],
          skippedSkills: [],
          nextSkill: "work",
          startedAt: new Date().toISOString(),
        });
        return;
      }

      // Test-file gate: check if any test files were created or modified
      if (!hasTestChanges(current.worktree) && !pipeline.completedSkills.includes("work-tests")) {
        warn("no test files in diff. Running /work again to add tests...");
        // Don't reset — run a targeted test-writing session on top of the existing implementation
        pipeline.completedSkills = pipeline.completedSkills.filter(s => s !== "work");
        pipeline.nextSkill = "work";
        savePipeline(pipeline);
        const testPrompt = buildTestRetryPrompt(current);
        info("running /work (test pass) for " + current.id + "...");
        const cwd = sessionCwd(current, current.phase);
        const exitCode = await runSession({ cwd, prompt: testPrompt });
        if (exitCode === 0) {
          pipeline.completedSkills.push("work", "work-tests");
          pipeline.nextSkill = null;
          savePipeline(pipeline);
        }
      }
    }

    // User gate for understand and design phases
    if (current.phase === "understand" || current.phase === "design") {
      const approved = await confirm(`${bold(current.phase)} phase complete. Approve and continue?`);
      if (!approved) {
        warn("Pipeline paused. Run gs-agentic start to resume.");
        return;
      }
    }

    // BR-09: QA failure rework loop
    if (current.phase === "verify") {
      const updated = loadTask(current.id);
      if (updated?.qaResult?.status === "fail") {
        warn(`QA failed: ${updated.qaResult.summary}`);
        const retry = await confirm("Retry implementation?");
        if (retry) {
          transitionTask(current.id, "implement", { force: true, actor: "orchestrator/qa-rework" });
          ok(`${bold(current.id)} → implement (rework)`);
          savePipeline({
            taskId: current.id,
            currentPhase: "implement",
            completedSkills: [],
            skippedSkills: [],
            nextSkill: "work",
            startedAt: new Date().toISOString(),
          });
          continue;
        }
        warn("Leaving task in verify for manual intervention.");
        return;
      }
    }

    // After ship: check if a PR exists (either via state or by checking git)
    if (current.phase === "ship") {
      const updated = loadTask(current.id)!;
      if (!updated.pr && updated.branch) {
        // Skill may have created a PR without updating state — check gh
        try {
          const { execaSync } = await import("execa");
          const ghResult = execaSync("gh", ["pr", "view", updated.branch, "--json", "url", "-q", ".url"], {
            cwd: updated.worktree ?? gitRoot(),
            stderr: "pipe",
          });
          const prUrl = ghResult.stdout.trim();
          if (prUrl) {
            updated.pr = prUrl;
            const { saveTask } = await import("./state.js");
            saveTask(updated);
            ok(`PR detected: ${prUrl}`);
          }
        } catch {}
      }
      if (!updated.pr) {
        warn("ship phase did not produce a PR.");
        warn(`task ${bold(current.id)} remains in ship. Run ${bold("gs-agentic start")} to retry.`);
        savePipeline({
          taskId: current.id,
          currentPhase: "ship",
          completedSkills: [],
          skippedSkills: [],
          nextSkill: "ship",
          startedAt: new Date().toISOString(),
        });
        return;
      }
    }

    // Advance to next phase
    advancePhase(current);
  }
}

// ── Run a skill with one retry on failure ────────────────────────────

async function runSkillWithRetry(
  skill: string,
  task: Task,
  pipeline: PipelineState,
): Promise<boolean> {
  const skills = phaseSkills(task.phase);

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      info(`retrying /${bold(skill)} for ${task.id} (attempt 2/2)...`);
    } else {
      info(`running /${bold(skill)} for ${task.id}...`);
    }

    const cwd = sessionCwd(task, task.phase);
    const prompt = buildSkillPrompt(skill, task);
    const exitCode = await runSession({ cwd, prompt });

    if (exitCode === 0) {
      // Mark completed
      pipeline.completedSkills.push(skill);
      const nextIdx = skills.indexOf(skill) + 1;
      pipeline.nextSkill = nextIdx < skills.length ? skills[nextIdx] : null;
      savePipeline(pipeline);
      return true;
    }

    if (attempt === 1) {
      warn(`/${skill} failed (exit ${exitCode}). Retrying once...`);
    }
  }

  // Both attempts failed
  console.error(red(`/${skill} failed after 2 attempts. Pipeline stopped.`));
  warn(`task ${bold(task.id)} remains in ${task.phase}. Run ${bold("gs-agentic start")} to retry.`);
  return false;
}

function advancePhase(task: Task): void {
  const order: Phase[] = ["understand", "design", "implement", "verify", "ship", "done"];
  const idx = order.indexOf(task.phase);
  if (idx < 0 || idx >= order.length - 1) return;

  const next = order[idx + 1];
  try {
    transitionTask(task.id, next, { actor: "orchestrator" });
    ok(`${bold(task.id)} → ${next}`);
  } catch (e: any) {
    warn(e.message);
  }
}

async function runEpicChildren(epic: Task): Promise<void> {
  info(`epic ${bold(epic.id)} has ${epic.children.length} workstreams`);

  for (const childId of epic.children) {
    const child = loadTask(childId);
    if (!child) {
      warn(`workstream ${childId} not found, skipping.`);
      continue;
    }
    if (child.phase === "done" || child.phase === "cancelled") {
      info(`${childId} already ${child.phase}, skipping.`);
      continue;
    }

    const { dependenciesMet } = await import("./state.js");
    if (!dependenciesMet(child)) {
      warn(`${childId} blocked by dependencies, skipping.`);
      continue;
    }

    info(`starting workstream ${bold(childId)}: ${child.title}`);
    await runPipeline(child);
  }

  ok(`epic ${bold(epic.id)} pipeline complete.`);
}
