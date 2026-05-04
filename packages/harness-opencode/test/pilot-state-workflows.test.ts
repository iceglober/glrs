// pilot-state-workflows.test.ts — tests for workflows/phases/artifacts accessors.
//
// Coverage:
//   - Workflow CRUD: create, get, list (newest-first), latest
//   - Workflow transitions: pending → running, running → completed/failed/aborted
//   - Illegal transitions: reject invalid status moves
//   - advancePhase: updates current_phase on workflow row
//   - Phase CRUD: create, get, list per workflow
//   - Phase transitions: pending → running → completed/failed
//   - Phase name constraint: reject invalid phase names
//   - Artifact CRUD: record, get, list by workflow+phase
//   - Artifact sha256: stored and retrievable
//   - FK cascades: deleting a workflow cascades to phases and artifacts
//   - appendEvent with phase parameter: stores and retrieves correctly

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { openStateDb } from "../src/pilot/state/db.js";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  latestWorkflow,
  markWorkflowRunning,
  markWorkflowFinished,
  advancePhase,
} from "../src/pilot/state/workflows.js";
import {
  createPhase,
  getPhase,
  listPhases,
  markPhaseRunning,
  markPhaseFinished,
} from "../src/pilot/state/phases.js";
import {
  recordArtifact,
  getArtifact,
  listArtifacts,
} from "../src/pilot/state/artifacts.js";
import {
  appendEvent,
  readEvents,
} from "../src/pilot/state/events.js";
import { createRun } from "../src/pilot/state/runs.js";
import type { Plan } from "../src/pilot/plan/schema.js";

// --- Fixtures --------------------------------------------------------------

let opened: ReturnType<typeof openStateDb>;
beforeEach(() => {
  opened = openStateDb(":memory:");
});
afterEach(() => opened.close());

function makePlan(): Plan {
  return {
    name: "test plan",
    defaults: {
      model: "anthropic/claude-sonnet-4-6",
      agent: "pilot-builder",
      max_turns: 50,
      max_cost_usd: 5,
      verify_after_each: [],
    },
    milestones: [],
    tasks: [],
  };
}

// --- Workflow CRUD ----------------------------------------------------------

describe("createWorkflow inserts a pending workflow", () => {
  test("returns a ULID-shaped id", () => {
    const id = createWorkflow(opened.db, { goal: "build a feature" });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("inserts a row with status=pending and correct goal", () => {
    const id = createWorkflow(opened.db, { goal: "my goal", now: 12345 });
    const wf = getWorkflow(opened.db, id);
    expect(wf).not.toBeNull();
    expect(wf?.status).toBe("pending");
    expect(wf?.goal).toBe("my goal");
    expect(wf?.started_at).toBe(12345);
    expect(wf?.finished_at).toBeNull();
    expect(wf?.current_phase).toBeNull();
  });
});

describe("getWorkflow returns workflow by id", () => {
  test("returns null for non-existent id", () => {
    expect(getWorkflow(opened.db, "nonexistent")).toBeNull();
  });

  test("returns the correct row for an existing id", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    const wf = getWorkflow(opened.db, id);
    expect(wf?.id).toBe(id);
    expect(wf?.goal).toBe("g");
  });
});

describe("listWorkflows returns newest first", () => {
  test("empty db returns empty array", () => {
    expect(listWorkflows(opened.db)).toEqual([]);
  });

  test("returns workflows ordered by started_at DESC", () => {
    const a = createWorkflow(opened.db, { goal: "a", now: 100 });
    const b = createWorkflow(opened.db, { goal: "b", now: 300 });
    const c = createWorkflow(opened.db, { goal: "c", now: 200 });
    const list = listWorkflows(opened.db);
    expect(list.map((w) => w.id)).toEqual([b, c, a]);
  });

  test("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      createWorkflow(opened.db, { goal: `g${i}`, now: i * 100 });
    }
    expect(listWorkflows(opened.db, 3).length).toBe(3);
  });
});

describe("markWorkflowRunning transitions pending to running", () => {
  test("transitions pending → running", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    markWorkflowRunning(opened.db, id);
    expect(getWorkflow(opened.db, id)?.status).toBe("running");
  });

  test("is idempotent when already running", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    markWorkflowRunning(opened.db, id);
    expect(() => markWorkflowRunning(opened.db, id)).not.toThrow();
    expect(getWorkflow(opened.db, id)?.status).toBe("running");
  });

  test("throws for non-existent workflow", () => {
    expect(() => markWorkflowRunning(opened.db, "ghost")).toThrow(/not found/);
  });

  test("throws when transitioning from a terminal status", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    markWorkflowRunning(opened.db, id);
    markWorkflowFinished(opened.db, id, "completed");
    expect(() => markWorkflowRunning(opened.db, id)).toThrow(/completed.*running/);
  });
});

describe("markWorkflowFinished sets terminal status", () => {
  test("transitions running → completed", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    markWorkflowRunning(opened.db, id);
    markWorkflowFinished(opened.db, id, "completed", 9999);
    const wf = getWorkflow(opened.db, id);
    expect(wf?.status).toBe("completed");
    expect(wf?.finished_at).toBe(9999);
  });

  test("transitions running → failed", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    markWorkflowRunning(opened.db, id);
    markWorkflowFinished(opened.db, id, "failed");
    expect(getWorkflow(opened.db, id)?.status).toBe("failed");
  });

  test("transitions running → aborted", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    markWorkflowRunning(opened.db, id);
    markWorkflowFinished(opened.db, id, "aborted");
    expect(getWorkflow(opened.db, id)?.status).toBe("aborted");
  });

  test("throws for non-terminal status", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    expect(() =>
      markWorkflowFinished(opened.db, id, "running" as never),
    ).toThrow(/terminal/);
  });

  test("throws for non-existent workflow", () => {
    expect(() =>
      markWorkflowFinished(opened.db, "ghost", "completed"),
    ).toThrow(/not found/);
  });
});

describe("advancePhase updates current_phase", () => {
  test("sets current_phase on a workflow", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    advancePhase(opened.db, id, "build");
    expect(getWorkflow(opened.db, id)?.current_phase).toBe("build");
  });

  test("can advance through multiple phases", () => {
    const id = createWorkflow(opened.db, { goal: "g" });
    advancePhase(opened.db, id, "scope");
    expect(getWorkflow(opened.db, id)?.current_phase).toBe("scope");
    advancePhase(opened.db, id, "plan");
    expect(getWorkflow(opened.db, id)?.current_phase).toBe("plan");
    advancePhase(opened.db, id, "build");
    expect(getWorkflow(opened.db, id)?.current_phase).toBe("build");
  });

  test("throws for non-existent workflow", () => {
    expect(() => advancePhase(opened.db, "ghost", "build")).toThrow(/not found/);
  });
});

// --- Phase CRUD ------------------------------------------------------------

describe("createPhase inserts a phase row", () => {
  test("inserts a pending phase row", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    const phase = getPhase(opened.db, wfId, "build");
    expect(phase).not.toBeNull();
    expect(phase?.status).toBe("pending");
    expect(phase?.started_at).toBeNull();
    expect(phase?.finished_at).toBeNull();
    expect(phase?.artifact_path).toBeNull();
  });

  test("throws FK error for non-existent workflow", () => {
    expect(() =>
      createPhase(opened.db, { workflowId: "ghost", name: "build" }),
    ).toThrow(/FOREIGN|constraint/i);
  });

  test("throws CHECK error for invalid phase name", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    expect(() =>
      createPhase(opened.db, { workflowId: wfId, name: "invalid" as never }),
    ).toThrow(/CHECK|constraint/i);
  });
});

describe("getPhase returns phase by workflow and name", () => {
  test("returns null for non-existent phase", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    expect(getPhase(opened.db, wfId, "build")).toBeNull();
  });

  test("returns the correct phase row", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "qa" });
    const phase = getPhase(opened.db, wfId, "qa");
    expect(phase?.workflow_id).toBe(wfId);
    expect(phase?.name).toBe("qa");
  });
});

describe("listPhases returns phases for a workflow", () => {
  test("returns empty array when no phases exist", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    expect(listPhases(opened.db, wfId)).toEqual([]);
  });

  test("returns phases in canonical order (scope, plan, build, qa, followup)", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    // Insert in reverse order to test ordering
    createPhase(opened.db, { workflowId: wfId, name: "followup" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    createPhase(opened.db, { workflowId: wfId, name: "scope" });
    const phases = listPhases(opened.db, wfId);
    expect(phases.map((p) => p.name)).toEqual(["scope", "build", "followup"]);
  });
});

describe("markPhaseRunning transitions pending to running", () => {
  test("transitions pending → running and stamps started_at", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    markPhaseRunning(opened.db, wfId, "build", 5000);
    const phase = getPhase(opened.db, wfId, "build");
    expect(phase?.status).toBe("running");
    expect(phase?.started_at).toBe(5000);
  });

  test("is idempotent when already running", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    markPhaseRunning(opened.db, wfId, "build", 1000);
    expect(() => markPhaseRunning(opened.db, wfId, "build", 2000)).not.toThrow();
    // started_at should not change on idempotent call
    expect(getPhase(opened.db, wfId, "build")?.started_at).toBe(1000);
  });

  test("throws for non-existent phase", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    expect(() => markPhaseRunning(opened.db, wfId, "build")).toThrow(/not found/);
  });

  test("throws when transitioning from a terminal status", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    markPhaseRunning(opened.db, wfId, "build");
    markPhaseFinished(opened.db, wfId, "build", "completed");
    expect(() => markPhaseRunning(opened.db, wfId, "build")).toThrow(/completed.*running/);
  });
});

describe("markPhaseFinished sets terminal status and finished_at", () => {
  test("transitions running → completed and stamps finished_at", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    markPhaseRunning(opened.db, wfId, "build");
    markPhaseFinished(opened.db, wfId, "build", "completed", 8888);
    const phase = getPhase(opened.db, wfId, "build");
    expect(phase?.status).toBe("completed");
    expect(phase?.finished_at).toBe(8888);
  });

  test("transitions running → failed", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "qa" });
    markPhaseRunning(opened.db, wfId, "qa");
    markPhaseFinished(opened.db, wfId, "qa", "failed");
    expect(getPhase(opened.db, wfId, "qa")?.status).toBe("failed");
  });

  test("throws for non-terminal status", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    expect(() =>
      markPhaseFinished(opened.db, wfId, "build", "running" as never),
    ).toThrow(/terminal/);
  });

  test("throws for non-existent phase", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    expect(() =>
      markPhaseFinished(opened.db, wfId, "build", "completed"),
    ).toThrow(/not found/);
  });
});

// --- Artifact CRUD ---------------------------------------------------------

describe("recordArtifact inserts an artifact row", () => {
  test("returns an auto-incremented id", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    const id1 = recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p/plan.yaml",
    });
    const id2 = recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p/plan2.yaml",
    });
    expect(id2).toBeGreaterThan(id1);
  });

  test("throws FK error for non-existent workflow", () => {
    expect(() =>
      recordArtifact(opened.db, {
        workflowId: "ghost",
        phase: "build",
        kind: "plan-yaml",
        path: "/p",
      }),
    ).toThrow(/FOREIGN|constraint/i);
  });
});

describe("listArtifacts returns artifacts for workflow+phase", () => {
  test("returns empty array when no artifacts exist", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    expect(listArtifacts(opened.db, { workflowId: wfId })).toEqual([]);
  });

  test("returns all artifacts for a workflow when no phase filter", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p1",
      now: 100,
    });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "qa",
      kind: "qa-report",
      path: "/p2",
      now: 200,
    });
    const all = listArtifacts(opened.db, { workflowId: wfId });
    expect(all.length).toBe(2);
  });

  test("filters by phase when phase is provided", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p1",
    });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "qa",
      kind: "qa-report",
      path: "/p2",
    });
    const buildArtifacts = listArtifacts(opened.db, {
      workflowId: wfId,
      phase: "build",
    });
    expect(buildArtifacts.length).toBe(1);
    expect(buildArtifacts[0]!.kind).toBe("plan-yaml");
  });

  test("returns artifacts in created_at ASC order", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "a",
      path: "/a",
      now: 300,
    });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "b",
      path: "/b",
      now: 100,
    });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "c",
      path: "/c",
      now: 200,
    });
    const arts = listArtifacts(opened.db, { workflowId: wfId, phase: "build" });
    expect(arts.map((a) => a.kind)).toEqual(["b", "c", "a"]);
  });
});

describe("artifact sha256 is stored and retrievable", () => {
  test("sha256 is stored and returned by getArtifact", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    const id = recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p/plan.yaml",
      sha256: "abc123def456",
    });
    const art = getArtifact(opened.db, id);
    expect(art?.sha256).toBe("abc123def456");
  });

  test("sha256 defaults to null when not provided", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    const id = recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p",
    });
    const art = getArtifact(opened.db, id);
    expect(art?.sha256).toBeNull();
  });

  test("getArtifact returns null for non-existent id", () => {
    expect(getArtifact(opened.db, 99999)).toBeNull();
  });
});

// --- appendEvent with phase parameter --------------------------------------

describe("appendEvent with phase parameter stores and retrieves correctly", () => {
  test("phase is stored when provided", () => {
    const plan = makePlan();
    const runId = createRun(opened.db, {
      plan,
      planPath: "/p",
      slug: "s",
    });
    appendEvent(opened.db, {
      runId,
      kind: "task.started",
      payload: {},
      phase: "build",
    });
    const events = readEvents(opened.db, { runId });
    expect(events.length).toBe(1);
    expect(events[0]!.phase).toBe("build");
  });

  test("phase defaults to null when not provided", () => {
    const plan = makePlan();
    const runId = createRun(opened.db, {
      plan,
      planPath: "/p",
      slug: "s",
    });
    appendEvent(opened.db, {
      runId,
      kind: "run.started",
      payload: {},
    });
    const events = readEvents(opened.db, { runId });
    expect(events[0]!.phase).toBeNull();
  });

  test("phase=null is stored explicitly", () => {
    const plan = makePlan();
    const runId = createRun(opened.db, {
      plan,
      planPath: "/p",
      slug: "s",
    });
    appendEvent(opened.db, {
      runId,
      kind: "run.started",
      payload: {},
      phase: null,
    });
    const events = readEvents(opened.db, { runId });
    expect(events[0]!.phase).toBeNull();
  });
});

// --- FK cascade: workflow → phases + artifacts ----------------------------

describe("FK cascade: deleting a workflow removes phases and artifacts", () => {
  test("deleting a workflow cascades to phases and artifacts", () => {
    const wfId = createWorkflow(opened.db, { goal: "g" });
    createPhase(opened.db, { workflowId: wfId, name: "build" });
    createPhase(opened.db, { workflowId: wfId, name: "qa" });
    recordArtifact(opened.db, {
      workflowId: wfId,
      phase: "build",
      kind: "plan-yaml",
      path: "/p",
    });

    opened.db.run("DELETE FROM workflows WHERE id=?", [wfId]);

    const phaseCount = (
      opened.db
        .query("SELECT COUNT(*) as n FROM phases WHERE workflow_id=?")
        .get(wfId) as { n: number }
    ).n;
    const artifactCount = (
      opened.db
        .query("SELECT COUNT(*) as n FROM artifacts WHERE workflow_id=?")
        .get(wfId) as { n: number }
    ).n;
    expect(phaseCount).toBe(0);
    expect(artifactCount).toBe(0);
  });
});
