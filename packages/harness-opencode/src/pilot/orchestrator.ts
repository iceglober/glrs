/**
 * Pilot v2 SPEAR orchestrator.
 *
 * Runs the autonomous phases: Plan → Execute → Assess → (re-plan if fail) → Resolve.
 * Called by `pilot go` after `pilot scope` has produced scope.json.
 *
 * The Assess phase includes deployment-risk reflection (the three SPEAR questions).
 * If Assess fails, the orchestrator re-plans the gap and loops (bounded by max_assess_cycles).
 */

import * as fs from "node:fs";
import { openStateDb, updateWorkflowStatus, logEvent } from "./state.js";
import { getStateDbPath, getCurrentScopePath } from "./paths.js";
import { checkSafety } from "./safety.js";
import { loadPilotConfig } from "./config.js";
import { startServer, selfTest } from "./server.js";
import { parseScopeArtifact, type ScopeArtifact } from "./scope.js";
import { runPlanPhase, parsePlanArtifact, type PlanArtifact } from "./plan.js";
import { runExecutePhase } from "./execute.js";
import { runAssessPhase } from "./assess.js";
import { runResolvePhase } from "./resolve.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorResult =
  | { ok: true; workflowId: string; goal: string; durationMs: number; acknowledgedRisks: string[] }
  | { ok: false; reason: string; workflowId?: string };

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runOrchestrator(opts: {
  cwd: string;
  scopePath?: string; // override; defaults to current-scope pointer
}): Promise<OrchestratorResult> {
  const { cwd } = opts;
  const startedAt = Date.now();

  // Safety check
  const safety = await checkSafety(cwd);
  if (!safety.ok) {
    return { ok: false, reason: safety.reason };
  }
  if (safety.warnings?.length) {
    for (const w of safety.warnings) {
      process.stderr.write(`[pilot] ${w}\n`);
    }
  }

  // Load config (with v1 detection banner)
  const config = loadPilotConfig(cwd);

  // Check for v1 config format and show prominent banner
  const { getPilotConfigPath } = await import("./paths.js");
  const configPath = getPilotConfigPath(cwd);
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (raw && typeof raw === "object" && ("baseline" in raw || "after_each" in raw)) {
        process.stderr.write(
          "\n\x1b[33m" +
          "┌─────────────────────────────────────────────────────────────────┐\n" +
          "│  ⚠️  Old pilot v1 config detected (.glrs/pilot.json)             │\n" +
          "│  Run `pilot configure` to set up v2 configuration.              │\n" +
          "│  Using defaults until then.                                     │\n" +
          "└─────────────────────────────────────────────────────────────────┘\n" +
          "\x1b[0m\n",
        );
      }
    } catch { /* ignore parse errors — loadPilotConfig already warned */ }
  }

  // Find scope
  const scopePath = opts.scopePath ?? await findCurrentScope(cwd);
  if (!scopePath) {
    return {
      ok: false,
      reason: "No scope found. Run `pilot scope \"<goal>\"` first.",
    };
  }

  // Parse scope
  let scope: ScopeArtifact;
  try {
    const raw = JSON.parse(fs.readFileSync(scopePath, "utf8"));
    const parsed = parseScopeArtifact(raw);
    if (!parsed) {
      return { ok: false, reason: `scope.json at ${scopePath} has invalid schema` };
    }
    scope = parsed;
  } catch {
    return { ok: false, reason: `Could not read scope.json at ${scopePath}` };
  }

  const workflowId = scope.workflow_id;

  // Open state DB
  const dbPath = await getStateDbPath(cwd);
  const { db, close: closeDb } = openStateDb(dbPath);

  logEvent(db, {
    workflowId,
    phase: "plan",
    kind: "workflow.go.started",
    payload: { goal: scope.goal, scopePath },
  });

  closeDb();

  // Start OpenCode server (shared across all phases)
  let server;
  try {
    server = await startServer({ cwd });
    await selfTest(server.client);
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to start OpenCode server: ${err instanceof Error ? err.message : String(err)}`,
      workflowId,
    };
  }

  try {
    // ── Plan phase ──────────────────────────────────────────────────────────
    const planResult = await runPlanPhase({ workflowId, scope, cwd, server });
    if (!planResult.ok) {
      return { ok: false, reason: `Plan phase failed: ${planResult.reason}`, workflowId };
    }

    let currentPlan: PlanArtifact = planResult.artifact;

    // ── Execute → Assess loop ────────────────────────────────────────────────
    const maxCycles = config.max_assess_cycles;

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      // Execute phase
      const executeResult = await runExecutePhase({
        workflowId,
        scope,
        plan: currentPlan,
        cwd,
        server,
      });

      if (!executeResult.ok) {
        return { ok: false, reason: `Execute phase failed: ${executeResult.reason}`, workflowId };
      }

      // Assess phase
      const assessResult = await runAssessPhase({
        workflowId,
        scope,
        plan: currentPlan,
        cwd,
        cycle,
        server,
      });

      if (!assessResult.ok) {
        return { ok: false, reason: `Assess phase failed: ${assessResult.reason}`, workflowId };
      }

      if (assessResult.verdict === "pass") {
        // ── Resolve phase ────────────────────────────────────────────────────
        const resolveResult = await runResolvePhase({
          workflowId,
          scope,
          assessment: assessResult.artifact,
          cwd,
          startedAt,
        });

        return {
          ok: true,
          workflowId,
          goal: scope.goal,
          durationMs: resolveResult.durationMs,
          acknowledgedRisks: resolveResult.acknowledgedRisks,
        };
      }

      // Assess failed — re-plan if cycles remain
      if (cycle < maxCycles) {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        process.stderr.write(
          `\n[pilot] ⚠️  Assess cycle ${cycle}/${maxCycles} failed. Re-planning...\n` +
          `  Gap: ${assessResult.replanGuidance}\n` +
          `  Elapsed: ${elapsedSec}s\n\n`,
        );

        const { db: replanDb, close: closeReplanDb } = openStateDb(dbPath);
        logEvent(replanDb, {
          workflowId,
          phase: "plan",
          kind: "task.plan.replan",
          payload: { gap: assessResult.replanGuidance, cycle },
        });
        closeReplanDb();

        // Re-plan: spawn a new planner session with the gap guidance
        const replanResult = await runPlanPhase({
          workflowId,
          scope: {
            ...scope,
            context: `${scope.context ?? ""}\n\nPrevious attempt failed. Gap to address:\n${assessResult.replanGuidance}`,
          },
          cwd,
          server,
        });

        if (!replanResult.ok) {
          return { ok: false, reason: `Re-plan failed: ${replanResult.reason}`, workflowId };
        }

        currentPlan = replanResult.artifact;
      }
    }

    // Exhausted cycles
    const { db: failDb, close: closeFailDb } = openStateDb(dbPath);
    updateWorkflowStatus(failDb, workflowId, "failed");
    logEvent(failDb, {
      workflowId,
      phase: "assess",
      kind: "task.assess.cycles.exhausted",
      payload: { max_cycles: maxCycles },
    });
    closeFailDb();

    return {
      ok: false,
      reason: `Assess failed after ${maxCycles} cycles. Manual intervention required.`,
      workflowId,
    };
  } finally {
    await server.shutdown();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findCurrentScope(cwd: string): Promise<string | null> {
  try {
    const pointerPath = await getCurrentScopePath(cwd);
    if (!fs.existsSync(pointerPath)) return null;
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    return typeof pointer.scopePath === "string" ? pointer.scopePath : null;
  } catch {
    return null;
  }
}
