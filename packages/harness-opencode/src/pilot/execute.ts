/**
 * Pilot v2 execute phase.
 *
 * Autonomous. Iterates through plan tasks, spawning one builder session per task.
 * Commits on verify pass. Produces an execution summary artifact.
 */

import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openStateDb, updateWorkflowStatus, logEvent } from "./state.js";
import { getStateDbPath } from "./paths.js";
import { sendAndWait, createSession } from "./server.js";
import type { PlanArtifact, PlanTask } from "./plan.js";
import type { ScopeArtifact } from "./scope.js";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Execute phase runner
// ---------------------------------------------------------------------------

export type TaskResult =
  | { ok: true; taskId: string; commitSha: string }
  | { ok: false; taskId: string; reason: string };

export type ExecuteResult =
  | { ok: true; taskResults: TaskResult[] }
  | { ok: false; reason: string; taskResults: TaskResult[] };

export async function runExecutePhase(opts: {
  workflowId: string;
  scope: ScopeArtifact;
  plan: PlanArtifact;
  cwd: string;
  server: { client: import("@opencode-ai/sdk").OpencodeClient };
}): Promise<ExecuteResult> {
  const { workflowId, scope, plan, cwd, server } = opts;

  const dbPath = await getStateDbPath(cwd);
  const { db, close: closeDb } = openStateDb(dbPath);

  updateWorkflowStatus(db, workflowId, "executing");

  logEvent(db, {
    workflowId,
    phase: "execute",
    kind: "task.execute.phase.started",
    payload: { task_count: plan.tasks.length },
  });

  const taskResults: TaskResult[] = [];

  try {
    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i]!;
      const taskNum = `${i + 1}/${plan.tasks.length}`;

      logEvent(db, {
        workflowId,
        phase: "execute",
        kind: "task.execute.started",
        payload: { task: taskNum, id: task.id, title: task.title },
        taskId: task.id,
      });

      const result = await runOneTask({
        workflowId,
        task,
        taskNum,
        scope,
        cwd,
        server,
        db,
      });

      taskResults.push(result);

      if (!result.ok) {
        logEvent(db, {
          workflowId,
          phase: "execute",
          kind: "task.execute.phase.failed",
          payload: { failed_task: task.id, reason: result.reason },
          taskId: task.id,
        });
        return { ok: false, reason: `Task ${task.id} failed: ${result.reason}`, taskResults };
      }

      logEvent(db, {
        workflowId,
        phase: "execute",
        kind: "task.execute.completed",
        payload: { task: taskNum, id: task.id, commit: result.commitSha },
        taskId: task.id,
      });
    }

    logEvent(db, {
      workflowId,
      phase: "execute",
      kind: "task.execute.phase.completed",
      payload: { task_count: plan.tasks.length },
    });

    return { ok: true, taskResults };
  } finally {
    closeDb();
  }
}

async function runOneTask(opts: {
  workflowId: string;
  task: PlanTask;
  taskNum: string;
  scope: ScopeArtifact;
  cwd: string;
  server: { client: import("@opencode-ai/sdk").OpencodeClient };
  db: import("bun:sqlite").Database;
}): Promise<TaskResult> {
  const { workflowId, task, taskNum, scope, cwd, server, db } = opts;

  // Capture HEAD before the task runs
  let headBefore: string;
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd });
    headBefore = stdout.trim();
  } catch {
    return { ok: false, taskId: task.id, reason: "Could not get HEAD SHA before task" };
  }

  // Create builder session
  let sessionId: string;
  try {
    sessionId = await createSession(server.client, {
      cwd,
      agentName: "pilot-builder",
    });
  } catch (err) {
    return {
      ok: false,
      taskId: task.id,
      reason: `Failed to create builder session: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Build the task prompt
  const taskPrompt = buildTaskPrompt({ task, scope, workflowId });

  // Send and wait
  const result = await sendAndWait(server.client, {
    sessionId,
    message: taskPrompt,
    stallMs: 15 * 60 * 1000, // 15 min per task
  });

  if (result.kind !== "idle") {
    // Clean up working tree
    await cleanWorkingTree(cwd);
    return {
      ok: false,
      taskId: task.id,
      reason: `Builder session ended unexpectedly: ${result.kind}`,
    };
  }

  // Run verify commands
  const verifyResult = await runVerifyCommands(task.verify, cwd);
  if (!verifyResult.ok) {
    await cleanWorkingTree(cwd);
    return {
      ok: false,
      taskId: task.id,
      reason: `Verify failed: ${verifyResult.reason}`,
    };
  }

  // Commit the changes
  let commitSha: string;
  try {
    // Check what files were modified — warn if unexpected files appear
    const { stdout: diffStat } = await execFileP("git", ["diff", "--name-only", "HEAD"], { cwd });
    const { stdout: untrackedRaw } = await execFileP("git", ["ls-files", "--others", "--exclude-standard"], { cwd });
    const modifiedFiles = diffStat.trim().split("\n").filter(Boolean);
    const untrackedFiles = untrackedRaw.trim().split("\n").filter(Boolean);
    const allFiles = [...modifiedFiles, ...untrackedFiles];

    if (allFiles.length > 20) {
      process.stderr.write(
        `  [pilot] ⚠️  Task ${task.id} modified ${allFiles.length} files — review the commit carefully\n`,
      );
    }

    await execFileP("git", ["add", "-A"], { cwd });
    await execFileP("git", ["commit", "-m", `pilot: ${task.title} (${task.id})`], { cwd });
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd });
    commitSha = stdout.trim();
  } catch (err) {
    await cleanWorkingTree(cwd);
    return {
      ok: false,
      taskId: task.id,
      reason: `Commit failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, taskId: task.id, commitSha };
}

async function runVerifyCommands(
  commands: string[],
  cwd: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const cmd of commands) {
    try {
      await execFileP("bash", ["-c", cmd], { cwd });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Command "${cmd}" failed: ${msg}` };
    }
  }
  return { ok: true };
}

async function cleanWorkingTree(cwd: string): Promise<void> {
  try {
    await execFileP("git", ["reset", "--hard", "HEAD"], { cwd });
    await execFileP("git", ["clean", "-fd"], { cwd });
  } catch {
    // Best effort
  }
}

function buildTaskPrompt(opts: {
  task: PlanTask;
  scope: ScopeArtifact;
  workflowId: string;
}): string {
  const { task, scope, workflowId } = opts;
  const verifyText = task.verify.length > 0
    ? task.verify.map((v) => `  - ${v}`).join("\n")
    : "  (no verify commands — just make the changes)";
  const addressesText = task.addresses.length > 0
    ? task.addresses.join(", ")
    : "(none specified)";

  return `You are executing a pilot task.

Workflow: ${workflowId}
Task: ${task.id} — ${task.title}
Addresses: ${addressesText}

${task.prompt}

Verify commands (run these after making changes):
${verifyText}

Rules:
- DO NOT commit. The orchestrator commits after verify passes.
- DO NOT push.
- DO NOT ask questions.
- If verify fails, fix the issue and re-run.
- If you cannot proceed after 3 attempts, output: STOP: <reason>`;
}
