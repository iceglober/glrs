/**
 * Pilot v2 resolve phase.
 *
 * The exit phase. Reads the assessment report, prints the final workflow
 * summary (what was done, total cost, duration, acknowledged risks),
 * and closes the workflow in SQLite.
 *
 * No new evaluation happens here — Assess is the quality gate.
 */

import { openStateDb, updateWorkflowStatus, logEvent, readEvents } from "./state.js";
import { getStateDbPath } from "./paths.js";
import type { AssessmentArtifact } from "./assess.js";
import type { ScopeArtifact } from "./scope.js";

export type ResolveResult = {
  workflowId: string;
  goal: string;
  durationMs: number;
  acknowledgedRisks: string[];
};

export async function runResolvePhase(opts: {
  workflowId: string;
  scope: ScopeArtifact;
  assessment: AssessmentArtifact;
  cwd: string;
  startedAt: number;
}): Promise<ResolveResult> {
  const { workflowId, scope, assessment, cwd, startedAt } = opts;

  const dbPath = await getStateDbPath(cwd);
  const { db, close: closeDb } = openStateDb(dbPath);

  logEvent(db, {
    workflowId,
    phase: "resolve",
    kind: "task.resolve.started",
    payload: {},
  });

  // Collect acknowledged (non-actionable or low-severity) risks
  const acknowledgedRisks = assessment.deployment_risks
    .filter((r) => !r.actionable || r.severity !== "high")
    .map((r) => r.description);

  if (acknowledgedRisks.length > 0) {
    logEvent(db, {
      workflowId,
      phase: "resolve",
      kind: "task.resolve.acknowledged_risks",
      payload: { risks: acknowledgedRisks },
    });
  }

  const durationMs = Date.now() - startedAt;

  updateWorkflowStatus(db, workflowId, "completed");

  logEvent(db, {
    workflowId,
    phase: "resolve",
    kind: "task.resolve.completed",
    payload: { acknowledged_risks: acknowledgedRisks.length },
  });

  logEvent(db, {
    workflowId,
    phase: "resolve",
    kind: "workflow.completed",
    payload: {
      duration: `${Math.round(durationMs / 1000)}s`,
    },
  });

  closeDb();

  return {
    workflowId,
    goal: scope.goal,
    durationMs,
    acknowledgedRisks,
  };
}
