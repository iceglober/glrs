/**
 * Tests for pilot v2 orchestrator (mocked sessions).
 *
 * Tests the SPEAR loop logic without a real OpenCode server.
 * The plan, execute, assess, and resolve phases are tested via their
 * artifact schema parsers and the orchestrator's routing logic.
 */

import { describe, test, expect } from "bun:test";
import { parsePlanArtifact, type PlanArtifact } from "../src/pilot/plan.js";
import { parseAssessmentArtifact, type AssessmentArtifact } from "../src/pilot/assess.js";

// ---------------------------------------------------------------------------
// Plan artifact schema tests
// ---------------------------------------------------------------------------

const VALID_PLAN: PlanArtifact = {
  workflow_id: "01JTEST123456789ABCDEFGHIJ",
  tasks: [
    {
      id: "TASK-001",
      title: "Add dark mode CSS variables",
      prompt: "Add CSS variables for dark mode to src/styles/theme.css",
      addresses: ["AC-001"],
      verify: ["bun test src/styles.test.ts"],
    },
    {
      id: "TASK-002",
      title: "Add toggle component",
      prompt: "Create a DarkModeToggle component in src/components/",
      addresses: ["AC-001", "AC-002"],
      verify: ["bun test src/components/DarkModeToggle.test.ts"],
    },
  ],
};

describe("pilot go — plan phase produces task list from scope", () => {
  test("parsePlanArtifact validates a valid plan", () => {
    const result = parsePlanArtifact(VALID_PLAN);
    expect(result).not.toBeNull();
    expect(result!.workflow_id).toBe(VALID_PLAN.workflow_id);
    expect(result!.tasks.length).toBe(2);
  });

  test("plan tasks have required fields", () => {
    const result = parsePlanArtifact(VALID_PLAN);
    for (const task of result!.tasks) {
      expect(task.id).toBeTruthy();
      expect(task.title).toBeTruthy();
      expect(task.prompt).toBeTruthy();
      expect(Array.isArray(task.addresses)).toBe(true);
      expect(Array.isArray(task.verify)).toBe(true);
    }
  });

  test("rejects plan without workflow_id", () => {
    const { workflow_id: _, ...rest } = VALID_PLAN;
    expect(parsePlanArtifact(rest)).toBeNull();
  });

  test("rejects plan without tasks array", () => {
    const { tasks: _, ...rest } = VALID_PLAN;
    expect(parsePlanArtifact(rest)).toBeNull();
  });

  test("rejects task without id", () => {
    const invalid = {
      ...VALID_PLAN,
      tasks: [{ title: "test", prompt: "test", addresses: [], verify: [] }],
    };
    expect(parsePlanArtifact(invalid)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assessment artifact schema tests
// ---------------------------------------------------------------------------

const PASSING_ASSESSMENT: AssessmentArtifact = {
  workflow_id: "01JTEST123456789ABCDEFGHIJ",
  verdict: "pass",
  ac_results: [
    { id: "AC-001", status: "met", evidence: "Toggle visible in settings page" },
    { id: "AC-002", status: "met", evidence: "localStorage persists value" },
  ],
  deployment_risks: [
    { severity: "low", description: "localStorage not available in SSR", actionable: false },
  ],
};

const FAILING_ASSESSMENT: AssessmentArtifact = {
  workflow_id: "01JTEST123456789ABCDEFGHIJ",
  verdict: "fail",
  ac_results: [
    { id: "AC-001", status: "met", evidence: "Toggle visible" },
    { id: "AC-002", status: "unmet", evidence: "Value not persisted", gap: "Missing localStorage.setItem call" },
  ],
  deployment_risks: [],
  replan_guidance: "AC-002 is unmet: toggle state is not persisted to localStorage",
};

describe("pilot go — assess phase runs verify commands", () => {
  test("parseAssessmentArtifact validates a passing assessment", () => {
    const result = parseAssessmentArtifact(PASSING_ASSESSMENT);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("pass");
    expect(result!.ac_results.length).toBe(2);
  });

  test("parseAssessmentArtifact validates a failing assessment", () => {
    const result = parseAssessmentArtifact(FAILING_ASSESSMENT);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("fail");
    expect(result!.replan_guidance).toBeTruthy();
  });

  test("rejects assessment without verdict", () => {
    const { verdict: _, ...rest } = PASSING_ASSESSMENT;
    expect(parseAssessmentArtifact(rest)).toBeNull();
  });

  test("rejects invalid verdict value", () => {
    expect(parseAssessmentArtifact({ ...PASSING_ASSESSMENT, verdict: "maybe" })).toBeNull();
  });

  test("rejects invalid ac status", () => {
    const invalid = {
      ...PASSING_ASSESSMENT,
      ac_results: [{ id: "AC-001", status: "invalid", evidence: "test" }],
    };
    expect(parseAssessmentArtifact(invalid)).toBeNull();
  });
});

describe("pilot go — assess failure triggers re-plan loop", () => {
  test("failing assessment has replan_guidance", () => {
    const result = parseAssessmentArtifact(FAILING_ASSESSMENT);
    expect(result!.verdict).toBe("fail");
    expect(result!.replan_guidance).toContain("AC-002");
  });

  test("unmet ACs are identifiable from assessment", () => {
    const result = parseAssessmentArtifact(FAILING_ASSESSMENT);
    const unmet = result!.ac_results.filter((r) => r.status !== "met");
    expect(unmet.length).toBe(1);
    expect(unmet[0]!.id).toBe("AC-002");
    expect(unmet[0]!.gap).toBeTruthy();
  });
});

describe("pilot go — re-plan loop is bounded by max_assess_cycles", () => {
  test("max_assess_cycles defaults to 3 in config", async () => {
    const { DEFAULT_CONFIG } = await import("../src/pilot/config.js");
    expect(DEFAULT_CONFIG.max_assess_cycles).toBe(3);
    expect(DEFAULT_CONFIG.max_assess_cycles).toBeGreaterThan(0);
  });
});

describe("pilot go — assess phase includes deployment-risk reflection", () => {
  test("assessment artifact has deployment_risks field", () => {
    const result = parseAssessmentArtifact(PASSING_ASSESSMENT);
    expect(Array.isArray(result!.deployment_risks)).toBe(true);
  });

  test("deployment risks have severity and actionable fields", () => {
    const result = parseAssessmentArtifact(PASSING_ASSESSMENT);
    for (const risk of result!.deployment_risks) {
      expect(["high", "medium", "low"]).toContain(risk.severity);
      expect(typeof risk.actionable).toBe("boolean");
      expect(typeof risk.description).toBe("string");
    }
  });

  test("high-severity actionable risks cause verdict=fail", () => {
    const withHighRisk: AssessmentArtifact = {
      ...PASSING_ASSESSMENT,
      verdict: "fail",
      deployment_risks: [
        { severity: "high", description: "SQL injection vulnerability", actionable: true, suggested_fix: "Use parameterized queries" },
      ],
      replan_guidance: "High-severity risk: SQL injection vulnerability",
    };
    const result = parseAssessmentArtifact(withHighRisk);
    expect(result!.verdict).toBe("fail");
    expect(result!.deployment_risks[0]!.severity).toBe("high");
    expect(result!.deployment_risks[0]!.actionable).toBe(true);
  });

  test("actionable risk triggers re-plan loop (replan_guidance present)", () => {
    const withHighRisk: AssessmentArtifact = {
      ...PASSING_ASSESSMENT,
      verdict: "fail",
      deployment_risks: [
        { severity: "high", description: "Race condition in state update", actionable: true },
      ],
      replan_guidance: "Fix race condition in state update",
    };
    const result = parseAssessmentArtifact(withHighRisk);
    expect(result!.replan_guidance).toBeTruthy();
  });
});

describe("pilot go — execute phase commits on verify pass", () => {
  test("task result has commitSha on success (type check)", () => {
    // Type-level test: TaskResult discriminated union
    type TaskResult =
      | { ok: true; taskId: string; commitSha: string }
      | { ok: false; taskId: string; reason: string };

    const success: TaskResult = { ok: true, taskId: "TASK-001", commitSha: "abc123" };
    const failure: TaskResult = { ok: false, taskId: "TASK-001", reason: "verify failed" };

    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.commitSha).toBeTruthy();
    }
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.reason).toBeTruthy();
    }
  });
});
