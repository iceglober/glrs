/**
 * Pilot v2 scope phase.
 *
 * Spawns an OpenCode TUI session with the pilot-scoper agent.
 * The user interacts conversationally; the scoper explores the codebase
 * and produces a scope.json artifact.
 *
 * The scope phase is the only interactive phase — all others are autonomous.
 *
 * Artifact location:
 *   ~/.glorious/opencode/<repo>/pilot/scopes/<workflowId>/scope.json
 *
 * Current-scope pointer:
 *   ~/.glorious/opencode/<repo>/pilot/current-scope.json
 *   → { workflowId, scopePath }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ulid } from "ulid";
import { openStateDb, createWorkflow, updateWorkflowStatus, logEvent } from "./state.js";
import { getStateDbPath, getScopeArtifactPath, getCurrentScopePath } from "./paths.js";
import { checkSafety } from "./safety.js";
import { loadPilotConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Scope artifact schema
// ---------------------------------------------------------------------------

export type AcceptanceCriterion = {
  id: string;
  description: string;
  verifiable: "shell" | "llm" | "manual";
};

export type ScopeArtifact = {
  workflow_id: string;
  goal: string;
  framing: string;
  acceptance_criteria: AcceptanceCriterion[];
  non_goals: string[];
  context?: string;
};

export function parseScopeArtifact(raw: unknown): ScopeArtifact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj["workflow_id"] !== "string") return null;
  if (typeof obj["goal"] !== "string") return null;
  if (typeof obj["framing"] !== "string") return null;
  if (!Array.isArray(obj["acceptance_criteria"])) return null;

  const acs: AcceptanceCriterion[] = [];
  for (const ac of obj["acceptance_criteria"]) {
    if (!ac || typeof ac !== "object") return null;
    const a = ac as Record<string, unknown>;
    if (typeof a["id"] !== "string") return null;
    if (typeof a["description"] !== "string") return null;
    const verifiable = a["verifiable"];
    if (verifiable !== "shell" && verifiable !== "llm" && verifiable !== "manual") return null;
    acs.push({ id: a["id"], description: a["description"], verifiable });
  }

  return {
    workflow_id: obj["workflow_id"] as string,
    goal: obj["goal"] as string,
    framing: obj["framing"] as string,
    acceptance_criteria: acs,
    non_goals: Array.isArray(obj["non_goals"])
      ? (obj["non_goals"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    context: typeof obj["context"] === "string" ? obj["context"] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Scope phase runner
// ---------------------------------------------------------------------------

export type ScopeResult =
  | { ok: true; workflowId: string; scopePath: string; artifact: ScopeArtifact }
  | { ok: false; reason: string };

export async function runScopePhase(opts: {
  goal: string;
  cwd: string;
}): Promise<ScopeResult> {
  const { goal, cwd } = opts;

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

  // Load config
  const config = loadPilotConfig(cwd);

  // Open state DB
  const dbPath = await getStateDbPath(cwd);
  const { db, close: closeDb } = openStateDb(dbPath);

  // Create workflow
  const workflowId = createWorkflow(db, {
    goal,
    config: JSON.stringify(config),
  });

  const scopePath = await getScopeArtifactPath(cwd, workflowId);

  logEvent(db, {
    workflowId,
    phase: "scope",
    kind: "workflow.started",
    payload: { id: workflowId, goal },
  });

  logEvent(db, {
    workflowId,
    phase: "scope",
    kind: "task.scope.started",
    payload: { scopePath },
  });

  // Spawn the OpenCode TUI with the pilot-scoper agent.
  // The user interacts directly with the TUI. When the session ends
  // (user closes it or scoper finishes), we check for scope.json.
  const scoperPrompt = buildScopePrompt({ goal, scopePath, workflowId });

  logEvent(db, {
    workflowId,
    phase: "scope",
    kind: "task.scope.tui.spawning",
    payload: { agent: "pilot-scoper" },
  });

  closeDb();

  try {
    const { spawn } = await import("node:child_process");

    // Build the initial prompt for the scoper
    const scoperPrompt = buildScopePrompt({ goal, scopePath, workflowId });

    // Spawn opencode TUI with the scoper agent and initial prompt.
    // The cwd of the child process sets the project directory.
    // --agent selects the pilot-scoper agent.
    // --prompt sends the initial message to kick off the conversation.
    const child = spawn(
      "opencode",
      ["--agent", "pilot-scoper", "--prompt", scoperPrompt],
      {
        stdio: "inherit", // TUI takes over the terminal
        cwd,
        env: { ...process.env },
      },
    );

    // Wait for the TUI to exit
    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });

    if (exitCode !== 0) {
      return {
        ok: false,
        reason: `OpenCode TUI exited with code ${exitCode}. Scope session may have been interrupted.`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to spawn OpenCode TUI: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Re-open DB to record completion
  const { db: db2, close: closeDb2 } = openStateDb(dbPath);

  try {
    // Check if scope.json was produced
    if (!fs.existsSync(scopePath)) {
      logEvent(db2, {
        workflowId,
        phase: "scope",
        kind: "task.scope.failed",
        payload: { reason: "scope.json not produced" },
      });
      closeDb2();
      return {
        ok: false,
        reason: `Scoper did not produce scope.json at ${scopePath}. The session may have ended without completing.`,
      };
    }

    // Parse and validate scope.json
    let artifact: ScopeArtifact | null;
    try {
      const raw = JSON.parse(fs.readFileSync(scopePath, "utf8"));
      artifact = parseScopeArtifact(raw);
    } catch {
      closeDb2();
      return { ok: false, reason: `scope.json at ${scopePath} has invalid JSON` };
    }

    if (!artifact) {
      closeDb2();
      return { ok: false, reason: `scope.json at ${scopePath} has invalid schema` };
    }

    // Update workflow status
    updateWorkflowStatus(db2, workflowId, "scoped", { scopePath });

    // Write current-scope pointer
    const currentScopePath = await getCurrentScopePath(cwd);
    fs.writeFileSync(
      currentScopePath,
      JSON.stringify({ workflowId, scopePath }, null, 2) + "\n",
      "utf8",
    );

    logEvent(db2, {
      workflowId,
      phase: "scope",
      kind: "task.scope.completed",
      payload: {
        scopePath,
        goal: artifact.goal,
        ac_count: artifact.acceptance_criteria.length,
      },
    });

    return { ok: true, workflowId, scopePath, artifact };
  } finally {
    closeDb2();
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildScopePrompt(opts: {
  goal: string;
  scopePath: string;
  workflowId: string;
}): string {
  return `You are starting a new pilot workflow.

Workflow ID: ${opts.workflowId}
User's goal: ${opts.goal}

Your job:
1. Understand what the user wants to build through conversation.
2. Explore the codebase to understand the current state.
3. Produce a scope.json artifact at: ${opts.scopePath}

The scope.json must follow this schema:
{
  "workflow_id": "${opts.workflowId}",
  "goal": "one sentence",
  "framing": "2-4 sentences: why this matters, what success looks like",
  "acceptance_criteria": [
    { "id": "AC-001", "description": "behavioral, verifiable statement", "verifiable": "shell|llm|manual" }
  ],
  "non_goals": ["what we are NOT doing"],
  "context": "optional: key patterns, constraints, background for the planner"
}

Start by asking the user to tell you more about their goal. Then explore the codebase. Then draft acceptance criteria and confirm with the user before writing scope.json.`;
}
