/**
 * Pilot v2 plan phase.
 *
 * Autonomous. Reads scope.json, spawns a planner session, and produces plan.json.
 */

import * as fs from "node:fs";
import { openStateDb, updateWorkflowStatus, logEvent } from "./state.js";
import { getStateDbPath, getPlanArtifactPath } from "./paths.js";
import { startServer, createSession, sendAndWait } from "./server.js";
import type { ScopeArtifact } from "./scope.js";

// ---------------------------------------------------------------------------
// Plan artifact schema
// ---------------------------------------------------------------------------

export type PlanTask = {
  id: string;
  title: string;
  prompt: string;
  addresses: string[];
  verify: string[];
};

export type PlanArtifact = {
  workflow_id: string;
  tasks: PlanTask[];
};

export function parsePlanArtifact(raw: unknown): PlanArtifact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj["workflow_id"] !== "string") return null;
  if (!Array.isArray(obj["tasks"])) return null;

  const tasks: PlanTask[] = [];
  for (const t of obj["tasks"]) {
    if (!t || typeof t !== "object") return null;
    const task = t as Record<string, unknown>;
    if (typeof task["id"] !== "string") return null;
    if (typeof task["title"] !== "string") return null;
    if (typeof task["prompt"] !== "string") return null;
    tasks.push({
      id: task["id"] as string,
      title: task["title"] as string,
      prompt: task["prompt"] as string,
      addresses: Array.isArray(task["addresses"])
        ? (task["addresses"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      verify: Array.isArray(task["verify"])
        ? (task["verify"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    });
  }

  return { workflow_id: obj["workflow_id"] as string, tasks };
}

// ---------------------------------------------------------------------------
// Plan phase runner
// ---------------------------------------------------------------------------

export type PlanResult =
  | { ok: true; planPath: string; artifact: PlanArtifact }
  | { ok: false; reason: string };

export async function runPlanPhase(opts: {
  workflowId: string;
  scope: ScopeArtifact;
  cwd: string;
  server: { client: import("@opencode-ai/sdk").OpencodeClient; shutdown: () => Promise<void> };
}): Promise<PlanResult> {
  const { workflowId, scope, cwd, server } = opts;

  const dbPath = await getStateDbPath(cwd);
  const { db, close: closeDb } = openStateDb(dbPath);

  const planPath = await getPlanArtifactPath(cwd, workflowId);

  logEvent(db, {
    workflowId,
    phase: "plan",
    kind: "task.plan.started",
    payload: { planPath },
  });

  try {
    const sessionId = await createSession(server.client, {
      cwd,
      agentName: "pilot-planner",
    });

    logEvent(db, {
      workflowId,
      phase: "plan",
      kind: "task.plan.session.created",
      payload: { sessionId },
      sessionId,
    });

    const plannerPrompt = buildPlannerPrompt({ workflowId, scope, planPath });

    const result = await sendAndWait(server.client, {
      sessionId,
      message: plannerPrompt,
      stallMs: 10 * 60 * 1000, // 10 min
    });

    if (result.kind !== "idle") {
      logEvent(db, {
        workflowId,
        phase: "plan",
        kind: "task.plan.failed",
        payload: { reason: result.kind },
        sessionId,
      });
      return { ok: false, reason: `Planner session ended unexpectedly: ${result.kind}` };
    }

    if (!fs.existsSync(planPath)) {
      return { ok: false, reason: `Planner did not produce plan.json at ${planPath}` };
    }

    let artifact: PlanArtifact | null;
    try {
      const raw = JSON.parse(fs.readFileSync(planPath, "utf8"));
      artifact = parsePlanArtifact(raw);
    } catch {
      return { ok: false, reason: `plan.json at ${planPath} has invalid JSON` };
    }

    if (!artifact) {
      return { ok: false, reason: `plan.json at ${planPath} has invalid schema` };
    }

    updateWorkflowStatus(db, workflowId, "planned", { planPath });

    logEvent(db, {
      workflowId,
      phase: "plan",
      kind: "task.plan.completed",
      payload: { planPath, task_count: artifact.tasks.length },
      sessionId,
    });

    return { ok: true, planPath, artifact };
  } finally {
    closeDb();
  }
}

function buildPlannerPrompt(opts: {
  workflowId: string;
  scope: ScopeArtifact;
  planPath: string;
}): string {
  const { workflowId, scope, planPath } = opts;
  const acsText = scope.acceptance_criteria
    .map((ac) => `  - ${ac.id}: ${ac.description} (verifiable: ${ac.verifiable})`)
    .join("\n");
  const nonGoalsText = scope.non_goals.length > 0
    ? scope.non_goals.map((ng) => `  - ${ng}`).join("\n")
    : "  (none specified)";

  return `You are planning a pilot workflow.

Workflow ID: ${workflowId}
Goal: ${scope.goal}
Framing: ${scope.framing}

Acceptance criteria:
${acsText}

Non-goals:
${nonGoalsText}

${scope.context ? `Context:\n${scope.context}\n\n` : ""}Your job:
1. Survey the codebase to understand the current state.
2. Decompose the work into an ordered list of tasks.
3. Write plan.json at: ${planPath}

The plan.json must follow this schema:
{
  "workflow_id": "${workflowId}",
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Short title",
      "prompt": "Detailed self-contained instructions for the builder",
      "addresses": ["AC-001"],
      "verify": ["bun test src/specific.test.ts"]
    }
  ]
}

Rules:
- Each task must be independently executable.
- Each task's prompt must be self-contained (include relevant context).
- Every AC must be addressed by at least one task.
- Tasks are executed sequentially — order matters.
- Aim for 3-7 tasks. More than 10 is too many.`;
}
