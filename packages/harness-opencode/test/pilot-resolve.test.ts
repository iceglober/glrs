/**
 * Tests for pilot v2 resolve phase.
 */

import { describe, test, expect } from "bun:test";
import { openStateDb, createWorkflow, getWorkflow } from "../src/pilot/state.js";
import { runResolvePhase } from "../src/pilot/resolve.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

function makeTmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-resolve-test-"));
  return path.join(dir, "state.sqlite");
}

// Mock GLORIOUS_PILOT_DIR to use temp dir
function withTmpPilotDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-resolve-dir-"));
  const orig = process.env["GLORIOUS_PILOT_DIR"];
  process.env["GLORIOUS_PILOT_DIR"] = dir;
  return fn(dir).finally(() => {
    if (orig === undefined) {
      delete process.env["GLORIOUS_PILOT_DIR"];
    } else {
      process.env["GLORIOUS_PILOT_DIR"] = orig;
    }
  });
}

const MOCK_SCOPE = {
  workflow_id: "01JTEST123456789ABCDEFGHIJ",
  goal: "Add dark mode",
  framing: "Users want dark mode",
  acceptance_criteria: [{ id: "AC-001", description: "Toggle exists", verifiable: "shell" as const }],
  non_goals: [],
};

const PASSING_ASSESSMENT = {
  workflow_id: "01JTEST123456789ABCDEFGHIJ",
  verdict: "pass" as const,
  ac_results: [{ id: "AC-001", status: "met" as const, evidence: "Toggle visible" }],
  deployment_risks: [
    { severity: "low" as const, description: "localStorage not available in SSR", actionable: false },
  ],
};

describe("pilot resolve — resolve produces risk assessment", () => {
  test("resolve returns acknowledged risks from assessment", async () => {
    await withTmpPilotDir(async (dir) => {
      const cwd = dir;
      const { db, close } = openStateDb(path.join(dir, "state.sqlite"));
      const wfId = createWorkflow(db, { goal: "test" });
      close();

      const result = await runResolvePhase({
        workflowId: wfId,
        scope: { ...MOCK_SCOPE, workflow_id: wfId },
        assessment: { ...PASSING_ASSESSMENT, workflow_id: wfId },
        cwd,
        startedAt: Date.now() - 5000,
      });

      expect(result.acknowledgedRisks.length).toBe(1);
      expect(result.acknowledgedRisks[0]).toContain("localStorage");
    });
  });
});

describe("pilot resolve — risks appear in workflow summary", () => {
  test("resolve marks workflow as completed in SQLite", async () => {
    await withTmpPilotDir(async (dir) => {
      const cwd = dir;
      const { db, close } = openStateDb(path.join(dir, "state.sqlite"));
      const wfId = createWorkflow(db, { goal: "test" });
      close();

      await runResolvePhase({
        workflowId: wfId,
        scope: { ...MOCK_SCOPE, workflow_id: wfId },
        assessment: { ...PASSING_ASSESSMENT, workflow_id: wfId },
        cwd,
        startedAt: Date.now() - 5000,
      });

      const { db: db2, close: close2 } = openStateDb(path.join(dir, "state.sqlite"));
      const wf = getWorkflow(db2, wfId);
      close2();

      expect(wf!.status).toBe("completed");
      expect(wf!.finished_at).not.toBeNull();
    });
  });

  test("resolve returns duration", async () => {
    await withTmpPilotDir(async (dir) => {
      const cwd = dir;
      const { db, close } = openStateDb(path.join(dir, "state.sqlite"));
      const wfId = createWorkflow(db, { goal: "test" });
      close();

      const startedAt = Date.now() - 10000; // 10 seconds ago
      const result = await runResolvePhase({
        workflowId: wfId,
        scope: { ...MOCK_SCOPE, workflow_id: wfId },
        assessment: { ...PASSING_ASSESSMENT, workflow_id: wfId },
        cwd,
        startedAt,
      });

      expect(result.durationMs).toBeGreaterThan(9000);
      expect(result.goal).toBe("Add dark mode"); // from scope.goal
    });
  });
});
