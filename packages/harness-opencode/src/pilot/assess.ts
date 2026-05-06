/**
 * Pilot v2 assess phase.
 *
 * Autonomous. Spawns an assessor session that:
 * 1. Performs deployment-risk reflection (the three SPEAR questions)
 * 2. Evaluates each AC from scope.json
 * 3. Produces an assessment report
 *
 * If verdict is "fail", returns the replan_guidance for the orchestrator.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openStateDb, updateWorkflowStatus, logEvent } from "./state.js";
import { getStateDbPath, getPilotDir } from "./paths.js";
import { sendAndWait, createSession } from "./server.js";
import type { ScopeArtifact } from "./scope.js";
import type { PlanArtifact } from "./plan.js";

// ---------------------------------------------------------------------------
// Assessment artifact schema
// ---------------------------------------------------------------------------

export type AcStatus = "met" | "unmet" | "partial";

export type AcResult = {
  id: string;
  status: AcStatus;
  evidence: string;
  gap?: string;
};

export type DeploymentRisk = {
  severity: "high" | "medium" | "low";
  description: string;
  actionable: boolean;
  suggested_fix?: string;
};

export type AssessmentArtifact = {
  workflow_id: string;
  verdict: "pass" | "fail";
  ac_results: AcResult[];
  deployment_risks: DeploymentRisk[];
  replan_guidance?: string;
};

export function parseAssessmentArtifact(raw: unknown): AssessmentArtifact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj["workflow_id"] !== "string") return null;
  if (obj["verdict"] !== "pass" && obj["verdict"] !== "fail") return null;
  if (!Array.isArray(obj["ac_results"])) return null;

  const acResults: AcResult[] = [];
  for (const r of obj["ac_results"]) {
    if (!r || typeof r !== "object") return null;
    const result = r as Record<string, unknown>;
    if (typeof result["id"] !== "string") return null;
    if (!["met", "unmet", "partial"].includes(result["status"] as string)) return null;
    if (typeof result["evidence"] !== "string") return null;
    acResults.push({
      id: result["id"] as string,
      status: result["status"] as AcStatus,
      evidence: result["evidence"] as string,
      gap: typeof result["gap"] === "string" ? result["gap"] : undefined,
    });
  }

  const risks: DeploymentRisk[] = [];
  if (Array.isArray(obj["deployment_risks"])) {
    for (const r of obj["deployment_risks"]) {
      if (!r || typeof r !== "object") continue;
      const risk = r as Record<string, unknown>;
      if (!["high", "medium", "low"].includes(risk["severity"] as string)) continue;
      if (typeof risk["description"] !== "string") continue;
      risks.push({
        severity: risk["severity"] as "high" | "medium" | "low",
        description: risk["description"] as string,
        actionable: Boolean(risk["actionable"]),
        suggested_fix: typeof risk["suggested_fix"] === "string" ? risk["suggested_fix"] : undefined,
      });
    }
  }

  return {
    workflow_id: obj["workflow_id"] as string,
    verdict: obj["verdict"] as "pass" | "fail",
    ac_results: acResults,
    deployment_risks: risks,
    replan_guidance: typeof obj["replan_guidance"] === "string" ? obj["replan_guidance"] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Assess phase runner
// ---------------------------------------------------------------------------

export type AssessResult =
  | { ok: true; verdict: "pass"; artifact: AssessmentArtifact }
  | { ok: true; verdict: "fail"; artifact: AssessmentArtifact; replanGuidance: string }
  | { ok: false; reason: string };

export async function runAssessPhase(opts: {
  workflowId: string;
  scope: ScopeArtifact;
  plan: PlanArtifact;
  cwd: string;
  cycle: number;
  server: { client: import("@opencode-ai/sdk").OpencodeClient };
}): Promise<AssessResult> {
  const { workflowId, scope, plan, cwd, cycle, server } = opts;

  const dbPath = await getStateDbPath(cwd);
  const { db, close: closeDb } = openStateDb(dbPath);

  updateWorkflowStatus(db, workflowId, "assessing");

  const assessPath = await getAssessArtifactPath(cwd, workflowId, cycle);

  logEvent(db, {
    workflowId,
    phase: "assess",
    kind: "task.assess.started",
    payload: { cycle, assessPath },
  });

  try {
    const sessionId = await createSession(server.client, {
      cwd,
      agentName: "pilot-assessor",
    });

    logEvent(db, {
      workflowId,
      phase: "assess",
      kind: "task.assess.session.created",
      payload: { sessionId, cycle },
      sessionId,
    });

    const assessorPrompt = buildAssessorPrompt({ workflowId, scope, plan, assessPath, cycle });

    const result = await sendAndWait(server.client, {
      sessionId,
      message: assessorPrompt,
      stallMs: 10 * 60 * 1000, // 10 min
    });

    if (result.kind !== "idle") {
      logEvent(db, {
        workflowId,
        phase: "assess",
        kind: "task.assess.failed",
        payload: { reason: result.kind, cycle },
        sessionId,
      });
      return { ok: false, reason: `Assessor session ended unexpectedly: ${result.kind}` };
    }

    if (!fs.existsSync(assessPath)) {
      return { ok: false, reason: `Assessor did not produce assessment report at ${assessPath}` };
    }

    let artifact: AssessmentArtifact | null;
    try {
      const raw = JSON.parse(fs.readFileSync(assessPath, "utf8"));
      artifact = parseAssessmentArtifact(raw);
    } catch {
      return { ok: false, reason: `Assessment report has invalid JSON` };
    }

    if (!artifact) {
      return { ok: false, reason: `Assessment report has invalid schema` };
    }

    // Log individual gate results
    for (const acResult of artifact.ac_results) {
      const kind = acResult.status === "met"
        ? "task.assess.gate.passed"
        : "task.assess.gate.failed";
      logEvent(db, {
        workflowId,
        phase: "assess",
        kind,
        payload: {
          gate: acResult.id,
          status: acResult.status,
          ...(acResult.gap ? { reason: acResult.gap } : {}),
        },
        sessionId,
      });
    }

    // Log deployment risks
    const highRisks = artifact.deployment_risks.filter((r) => r.severity === "high" && r.actionable);
    if (highRisks.length > 0) {
      logEvent(db, {
        workflowId,
        phase: "assess",
        kind: "task.assess.risk_check",
        payload: { risks: highRisks.map((r) => r.description) },
        sessionId,
      });
    }

    if (artifact.verdict === "pass") {
      logEvent(db, {
        workflowId,
        phase: "assess",
        kind: "task.assess.passed",
        payload: { all_acs_met: true, cycle },
        sessionId,
      });
      return { ok: true, verdict: "pass", artifact };
    } else {
      const unmetAcs = artifact.ac_results.filter((r) => r.status !== "met").map((r) => r.id);
      logEvent(db, {
        workflowId,
        phase: "assess",
        kind: "task.assess.failed",
        payload: { unmet: unmetAcs, cycle },
        sessionId,
      });
      return {
        ok: true,
        verdict: "fail",
        artifact,
        replanGuidance: artifact.replan_guidance ?? `Unmet ACs: ${unmetAcs.join(", ")}`,
      };
    }
  } finally {
    closeDb();
  }
}

async function getAssessArtifactPath(cwd: string, workflowId: string, cycle: number): Promise<string> {
  const base = await getPilotDir(cwd);
  const dir = path.join(base, "scopes", workflowId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `assessment-cycle-${cycle}.json`);
}

function buildAssessorPrompt(opts: {
  workflowId: string;
  scope: ScopeArtifact;
  plan: PlanArtifact;
  assessPath: string;
  cycle: number;
}): string {
  const { workflowId, scope, plan, assessPath, cycle } = opts;
  const acsText = scope.acceptance_criteria
    .map((ac) => `  - ${ac.id}: ${ac.description} (verifiable: ${ac.verifiable})`)
    .join("\n");

  return `You are assessing a pilot workflow.

Workflow: ${workflowId}
Goal: ${scope.goal}
Assessment cycle: ${cycle}

Acceptance criteria to evaluate:
${acsText}

Your job:
1. FIRST: Deployment-risk reflection. Ask yourself:
   - What could break when this deploys?
   - What unexpected consequences could this change have on existing functionality?
   - What could go wrong?

2. THEN: Evaluate each AC against the current state of the codebase.
   - Run verify commands from the plan.
   - Check the git diff to see what changed.
   - For shell-verifiable ACs, run the commands.
   - For llm-verifiable ACs, use your judgment.

3. Write your assessment to: ${assessPath}

The assessment must follow this schema:
{
  "workflow_id": "${workflowId}",
  "verdict": "pass|fail",
  "ac_results": [
    { "id": "AC-001", "status": "met|unmet|partial", "evidence": "what you observed", "gap": "if unmet: what's missing" }
  ],
  "deployment_risks": [
    { "severity": "high|medium|low", "description": "what could go wrong", "actionable": true, "suggested_fix": "optional" }
  ],
  "replan_guidance": "if verdict=fail: specific guidance for the re-planner"
}

Verdict is "pass" only if ALL ACs are "met" AND no high-severity actionable risks exist.`;
}
