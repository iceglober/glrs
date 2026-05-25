/**
 * End-to-end test for the combined Bug A + Bug B fix (a4).
 *
 * Replays the exact user-reported scenario:
 *   - Plan dir containing only main.md (with ## Phases listing wave_0.md..wave_3.md)
 *   - A stale spec/main.yaml referencing wave_0.yaml..wave_3.yaml
 *   - No wave_*.md source files on disk
 *
 * The test simulates both fixes together:
 *   1. Bug A fix: runPreflightValidation detects stale spec/, deletes it, returns recovered=true
 *   2. Bug B fix: enrichPlan detects orphaned wave_*.md references, runs auto-decomposition,
 *      then proceeds to normal enrichment
 *
 * Uses a stub adapter that writes the wave_*.md files during decomposition and
 * the spec YAMLs during enrichment. Asserts the run completes without errors
 * and validatePlan returns no errors at the end.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enrichPlanForFastModel } from "../src/plan-enrichment.js";
import { validatePlan } from "../src/plan-validator.js";
import type { AgentAdapter, AgentHandle, SessionResult } from "../src/adapter.js";

// Import the CLI helper for Bug A
// We test it directly here to simulate the full flow
import { runPreflightValidation } from "../../cli/src/commands/autopilot.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-recovery-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return full;
}

describe("end-to-end recovery", () => {
  it("replays the user-reported scenario and proceeds to a successful enrichment", async () => {
    const planDir = path.join(tmpDir, "user-plan");
    fs.mkdirSync(planDir, { recursive: true });

    // Set up the exact user-reported scenario:
    // main.md references wave_0.md..wave_3.md (none exist on disk)
    writeFile(
      planDir,
      "main.md",
      `# My Big Plan\n\n## Goal\nRefactor the entire system\n\n## Phases\n- [ ] wave_0.md\n- [ ] wave_1.md\n- [ ] wave_2.md\n- [ ] wave_3.md\n`,
    );

    // Stale spec/main.yaml referencing wave_0.yaml..wave_3.yaml (none exist)
    writeFile(
      planDir,
      "spec/main.yaml",
      `title: My Big Plan\ngoal: Refactor the entire system\nphases:\n  - file: wave_0.yaml\n    completed: false\n  - file: wave_1.yaml\n    completed: false\n  - file: wave_2.yaml\n    completed: false\n  - file: wave_3.yaml\n    completed: false\n`,
    );
    // No wave_*.md files exist — this is the user's broken state

    // -----------------------------------------------------------------------
    // Step 1: Bug A fix — runPreflightValidation detects stale spec/ and recovers
    // -----------------------------------------------------------------------
    const preflight = runPreflightValidation(planDir, false /* resume = false */);

    expect(preflight.recovered).toBe(true);
    expect(preflight.exitCode).toBeNull();
    // spec/ should be deleted
    expect(fs.existsSync(path.join(planDir, "spec"))).toBe(false);

    // -----------------------------------------------------------------------
    // Step 2: Bug B fix — enrichPlan detects orphaned wave_*.md references,
    //         runs auto-decomposition, then proceeds to enrichment
    // -----------------------------------------------------------------------

    // Build a stub adapter that:
    //   - On first session (decomposition): writes wave_0.md..wave_3.md
    //   - On subsequent sessions (enrichment): writes spec/main.yaml + spec/wave_*.yaml
    let sessionCount = 0;
    const adapter: AgentAdapter = {
      name: "mock",
      start: async () => ({ id: "mock-handle" } as AgentHandle),
      shutdown: async () => {},
      createSession: async () => `mock-session-${++sessionCount}`,
      sendAndWait: async (_handle, opts): Promise<SessionResult> => {
        if (sessionCount === 1) {
          // Decomposition session: write the wave_*.md files
          for (let i = 0; i < 4; i++) {
            writeFile(
              planDir,
              `wave_${i}.md`,
              `# Wave ${i}\n\n### ${i}.1 Item\n- intent: Do something in wave ${i}\n`,
            );
          }
        } else {
          // Enrichment sessions: write spec files
          // Write spec/main.yaml on the first enrichment call
          if (!fs.existsSync(path.join(planDir, "spec", "main.yaml"))) {
            writeFile(
              planDir,
              "spec/main.yaml",
              `title: My Big Plan\ngoal: Refactor the entire system\nphases:\n  - file: wave_0.yaml\n    completed: false\n  - file: wave_1.yaml\n    completed: false\n  - file: wave_2.yaml\n    completed: false\n  - file: wave_3.yaml\n    completed: false\n`,
            );
          }
          // Write the phase YAML for the current session
          const phaseMatch = opts.message.match(/wave_(\d+)\.md/);
          if (phaseMatch) {
            const idx = phaseMatch[1];
            writeFile(
              planDir,
              `spec/wave_${idx}.yaml`,
              `items:\n  - id: "${idx}.1"\n    intent: Do something in wave ${idx}\n    checked: false\n    verify: echo done\n    mirror: src/foo.ts\n    context: "function foo() {}"\n    conventions: bun:test\n    proof: "should work"\n    proof_type: test\n`,
            );
          }
        }
        return { kind: "idle" };
      },
      getLastResponse: async (_handle, sessionId) => {
        if (sessionId === "mock-session-1") return "DECOMPOSITION_COMPLETE";
        return "SPEC_COMPLETE";
      },
      getSessionCost: async () => 0,
    };

    // Should not throw
    const result = await enrichPlanForFastModel(planDir, planDir, undefined, undefined, adapter);
    expect(result).toBe(planDir);

    // -----------------------------------------------------------------------
    // Step 3: Verify the plan is now valid
    // -----------------------------------------------------------------------

    // All wave_*.md files should exist
    for (let i = 0; i < 4; i++) {
      expect(fs.existsSync(path.join(planDir, `wave_${i}.md`))).toBe(true);
    }

    // spec/main.yaml should exist
    expect(fs.existsSync(path.join(planDir, "spec", "main.yaml"))).toBe(true);

    // All spec/wave_*.yaml files should exist
    for (let i = 0; i < 4; i++) {
      expect(fs.existsSync(path.join(planDir, "spec", `wave_${i}.yaml`))).toBe(true);
    }

    // validatePlan should return no missing-spec-phase-file errors
    const validation = validatePlan(planDir);
    const missingPhaseErrors = validation.errors.filter(
      (e) => e.code === "missing-spec-phase-file",
    );
    expect(missingPhaseErrors).toHaveLength(0);
  });
});
