/**
 * Tests for stale-spec auto-recovery in plan-enrichment (a1, a2).
 *
 * Covers:
 *   a1 — re-enriches main.md when spec/main.yaml references phase files
 *        that don't exist on disk AND no existing phase has checked items.
 *   a1 — skips re-enrichment when any existing phase file has checked items
 *        (safety guard: don't clobber in-progress work).
 *   a1 — skips re-enrichment for a valid single-phase plan where all phase
 *        files are present (normal idempotency path is unaffected).
 *   a2 — end-to-end: after auto-recovery, validatePlan returns no
 *        missing-spec-phase-file errors.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enrichPlan } from "../src/plan-enrichment.js";
import { validatePlan } from "../src/plan-validator.js";
import type { AgentAdapter, AgentHandle } from "../src/adapter.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stale-spec-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return full;
}

/**
 * Build a minimal mock adapter that tracks which files were enriched.
 *
 * When `planDir` is provided, the adapter writes stub spec YAML files
 * during `getLastResponse` so that post-enrichment validation passes.
 * Without `planDir`, it returns SPEC_COMPLETE without writing anything.
 */
function makeTrackingAdapter(planDir?: string): { adapter: AgentAdapter; enrichedFiles: string[] } {
  const enrichedFiles: string[] = [];
  let sessionCounter = 0;

  const adapter: AgentAdapter = {
    name: "mock",
    start: async () => ({ id: "mock-handle" } as AgentHandle),
    shutdown: async () => {},
    createSession: async (_handle, opts) => {
      enrichedFiles.push(opts?.agentName ?? "unknown");
      const sid = `mock-session-${sessionCounter++}`;
      return sid;
    },
    sendAndWait: async () => ({ kind: "idle" as const, title: "" }),
    getLastResponse: async (_handle: AgentHandle, _sessionId: string) => {
      if (planDir) {
        // Write any missing spec phase files referenced in spec/main.yaml
        const mainYamlPath = path.join(planDir, "spec", "main.yaml");
        if (fs.existsSync(mainYamlPath)) {
          const mainContent = fs.readFileSync(mainYamlPath, "utf-8");
          const fileRefs = mainContent.match(/file:\s*(\S+\.yaml)/g) ?? [];
          for (const ref of fileRefs) {
            const fname = ref.replace(/^file:\s*/, "");
            const fpath = path.join(planDir, "spec", fname);
            if (!fs.existsSync(fpath)) {
              writeFile(planDir, `spec/${fname}`, `items:
  - id: "0.1"
    intent: "Stub item"
    checked: false
    verify: echo done
    mirror: "src/stub.ts"
    context: "stub context"
    conventions: "stub conventions"
    proof: "stub proof"
    proof_type: "test"
`);
            }
          }
        }
      }
      return "SPEC_COMPLETE";
    },
    getSessionCost: async () => 0,
  };
  return { adapter, enrichedFiles };
}

// ---------------------------------------------------------------------------
// a1: re-enriches main.md when referenced phase files are missing
// ---------------------------------------------------------------------------

describe("stale spec auto-recovery", () => {
  it("re-enriches main.md when referenced phase files are missing", async () => {
    const planDir = path.join(tmpDir, "stale-plan");
    fs.mkdirSync(planDir);

    // Write main.md
    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.md\n`,
    );
    // Write wave_0.md so the plan directory is valid
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n- [ ] 1.1 **Item one**\n`);

    // Write spec/main.yaml that references wave_0.yaml — but DON'T write wave_0.yaml
    writeFile(
      planDir,
      "spec/main.yaml",
      `title: My Plan
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
    );
    // wave_0.yaml is intentionally absent — this is the stale-spec scenario

    // Build a mock emitter to capture events
    const emittedEvents: Array<{ type: string; file?: string }> = [];
    const mockEmitter = {
      emitEvent: (e: { type: string; file?: string }) => {
        emittedEvents.push(e);
      },
    };

    const { adapter } = makeTrackingAdapter(planDir);

    await enrichPlan(
      planDir,
      planDir,
      undefined,
      mockEmitter as never,
      adapter,
    );

    // The stale-spec recovery should NOT emit enrich:file:skip for main.md
    const skipEventsForMain = emittedEvents.filter(
      (e) => e.type === "enrich:file:skip" && e.file?.includes("main.md"),
    );
    expect(skipEventsForMain).toHaveLength(0);

    // An enrich:file:start event should have been emitted for main.md
    const startEventsForMain = emittedEvents.filter(
      (e) => e.type === "enrich:file:start" && e.file?.includes("main.md"),
    );
    expect(startEventsForMain.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // a1: skips re-enrichment when missing-phase recovery would clobber checked items
  // ---------------------------------------------------------------------------

  it("skips re-enrichment when missing-phase recovery would clobber checked items", async () => {
    const planDir = path.join(tmpDir, "checked-plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.md\n- [ ] wave_1.md\n`,
    );
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n- [ ] 1.1 **Item one**\n`);
    writeFile(planDir, "wave_1.md", `# Wave 1\n\n- [ ] 2.1 **Item two**\n`);

    // spec/main.yaml references wave_0.yaml and wave_1.yaml
    writeFile(
      planDir,
      "spec/main.yaml",
      `title: My Plan
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
  - file: wave_1.yaml
    completed: false
`,
    );

    // wave_0.yaml EXISTS and has a checked item — safety guard must fire
    writeFile(
      planDir,
      "spec/wave_0.yaml",
      `items:
  - id: "1.1"
    intent: Item one
    checked: true
    verify: echo done
`,
    );
    // wave_1.yaml is absent — stale-spec scenario, but wave_0 has checked items

    const emittedEvents: Array<{ type: string; file?: string }> = [];
    const mockEmitter = {
      emitEvent: (e: { type: string; file?: string }) => {
        emittedEvents.push(e);
      },
    };

    const { adapter } = makeTrackingAdapter();

    // The enrichment will throw because the mock adapter doesn't write
    // wave_1.yaml and post-enrichment validation fails. We only care
    // about the emitted events — the safety guard fires during the
    // enrichment pass before validation runs.
    try {
      await enrichPlan(
        planDir,
        planDir,
        undefined,
        mockEmitter as never,
        adapter,
      );
    } catch {
      // Expected — validation fails because wave_1.yaml is never written
    }

    // main.md should be SKIPPED (safety guard: wave_0 has checked items)
    const skipEventsForMain = emittedEvents.filter(
      (e) => e.type === "enrich:file:skip" && e.file?.includes("main.md"),
    );
    expect(skipEventsForMain.length).toBeGreaterThan(0);

    // No enrich:file:start for main.md
    const startEventsForMain = emittedEvents.filter(
      (e) => e.type === "enrich:file:start" && e.file?.includes("main.md"),
    );
    expect(startEventsForMain).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // a1: skips re-enrichment for valid single-phase plan with all phase files present
  // ---------------------------------------------------------------------------

  it("skips re-enrichment for valid single-phase plan with all phase files present", async () => {
    const planDir = path.join(tmpDir, "valid-plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.md\n`,
    );
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n- [ ] 1.1 **Item one**\n`);

    // Both spec files exist — normal idempotency path
    writeFile(
      planDir,
      "spec/main.yaml",
      `title: My Plan
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
    );
    writeFile(
      planDir,
      "spec/wave_0.yaml",
      `items:
  - id: "1.1"
    intent: Item one
    checked: false
    verify: echo done
`,
    );

    const emittedEvents: Array<{ type: string; file?: string }> = [];
    const mockEmitter = {
      emitEvent: (e: { type: string; file?: string }) => {
        emittedEvents.push(e);
      },
    };

    const { adapter } = makeTrackingAdapter();

    await enrichPlan(
      planDir,
      planDir,
      undefined,
      mockEmitter as never,
      adapter,
    );

    // main.md should be skipped (spec already exists and all phase files present)
    const skipEventsForMain = emittedEvents.filter(
      (e) => e.type === "enrich:file:skip" && e.file?.includes("main.md"),
    );
    expect(skipEventsForMain.length).toBeGreaterThan(0);

    // No enrich:file:start for main.md
    const startEventsForMain = emittedEvents.filter(
      (e) => e.type === "enrich:file:start" && e.file?.includes("main.md"),
    );
    expect(startEventsForMain).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // a2: end-to-end: stale spec is recovered and validatePlan passes
  // ---------------------------------------------------------------------------

  it("end-to-end: stale spec is recovered and validatePlan passes", async () => {
    const planDir = path.join(tmpDir, "e2e-plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.md\n`,
    );
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n- [ ] 1.1 **Item one**\n`);

    // Stale spec/main.yaml references wave_0.yaml which doesn't exist
    writeFile(
      planDir,
      "spec/main.yaml",
      `title: My Plan
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
    );
    // wave_0.yaml intentionally absent

    // Before recovery: validatePlan should report missing-spec-phase-file
    const beforeReport = validatePlan(planDir);
    const beforeErrors = beforeReport.errors.filter(
      (e) => e.code === "missing-spec-phase-file",
    );
    expect(beforeErrors.length).toBeGreaterThan(0);

    // Build an adapter that writes a valid spec/main.yaml + spec/wave_0.yaml
    // when enrichment runs (simulating what the real enrichment agent does).
    const adapter: AgentAdapter = {
      name: "mock",
      start: async () => ({ id: "mock-handle" } as AgentHandle),
      shutdown: async () => {},
      createSession: async () => "mock-session",
      sendAndWait: async () => ({ kind: "idle" as const, title: "" }),
      getLastResponse: async (_handle: AgentHandle, _sessionId: string) => {
        // Write the spec files that the enrichment would produce
        writeFile(
          planDir,
          "spec/main.yaml",
          `title: My Plan
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
        );
        writeFile(
          planDir,
          "spec/wave_0.yaml",
          `items:
  - id: "1.1"
    intent: Item one
    checked: false
    verify: echo done
    mirror: src/foo.ts
    context: "function foo() {}"
    conventions: bun:test
    proof: "should work"
    proof_type: test
`,
        );
        return "SPEC_COMPLETE";
      },
      getSessionCost: async () => 0,
    };

    await enrichPlan(planDir, planDir, undefined, undefined, adapter);

    // After recovery: validatePlan should have no missing-spec-phase-file errors
    const afterReport = validatePlan(planDir);
    const afterErrors = afterReport.errors.filter(
      (e) => e.code === "missing-spec-phase-file",
    );
    expect(afterErrors).toHaveLength(0);
  });
});
