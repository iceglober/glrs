/**
 * Tests for the autopilot CLI summary renderer (a3).
 *
 * renderSummary() is extracted from commands/autopilot.ts so it can be
 * unit-tested without spawning a subprocess.
 *
 * Covers:
 *   - sentinel exit → ✓ header, exit code 0
 *   - max-iterations exit → ✓ header, exit code 0
 *   - kill-switch exit → ◼ header (neutral), exit code 0, Reason when message present
 *   - error exit → ✗ header, Reason line with message, exit code 1
 *   - struggle/stall/timeout/aborted exits → ✗ header, exit code 1
 *   - failure exit with empty message → no Reason line, still exits 1
 *   - summary partition uses imported SUCCESS_REASONS, not a string literal
 */

import { describe, it, expect } from "bun:test";
import { renderSummary } from "../src/commands/autopilot.js";
import { isSuccessExitReason } from "@glrs-dev/autopilot";
import type { LoopExitReason } from "@glrs-dev/autopilot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  exitReason: LoopExitReason,
  message = "",
  iterations = 3,
  cumulativeCostUsd?: number,
) {
  return {
    planPath: "/plans/my-plan",
    loopResult: {
      exitReason,
      iterations,
      message,
      cumulativeCostUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// Success bucket
// ---------------------------------------------------------------------------

describe("renderSummary", () => {
  it("sentinel exit prints ✓ header, exit code 0, optional Reason line", () => {
    const { stdout, exitCode } = renderSummary(makeResult("sentinel", "Done"));
    expect(stdout).toContain("✓ Autopilot complete");
    expect(stdout).toContain("Reason: Done");
    expect(exitCode).toBe(0);
  });

  it("sentinel exit with empty message omits Reason line", () => {
    const { stdout, exitCode } = renderSummary(makeResult("sentinel", ""));
    expect(stdout).toContain("✓ Autopilot complete");
    expect(stdout).not.toContain("Reason:");
    expect(exitCode).toBe(0);
  });

  it("max-iterations exit prints ✗ header, exit code 1", () => {
    const { stdout, exitCode } = renderSummary(makeResult("max-iterations"));
    expect(stdout).toContain("✗ Autopilot failed");
    expect(exitCode).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Neutral bucket
  // ---------------------------------------------------------------------------

  it("kill-switch exit prints ◼ header (neutral), exit code 0, Reason line when message present", () => {
    const { stdout, exitCode } = renderSummary(
      makeResult("kill-switch", "User stopped the run"),
    );
    expect(stdout).toContain("◼ Autopilot stopped (kill switch)");
    expect(stdout).toContain("Reason: User stopped the run");
    expect(exitCode).toBe(0);
  });

  it("kill-switch exit with empty message omits Reason line", () => {
    const { stdout, exitCode } = renderSummary(makeResult("kill-switch", ""));
    expect(stdout).toContain("◼ Autopilot stopped (kill switch)");
    expect(stdout).not.toContain("Reason:");
    expect(exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Failure bucket
  // ---------------------------------------------------------------------------

  it("error exit prints ✗ header, Reason line with message, exit code 1", () => {
    const { stdout, exitCode } = renderSummary(
      makeResult("error", "Agent crashed with SIGKILL", 0),
    );
    expect(stdout).toContain("✗ Autopilot failed");
    expect(stdout).toContain("Reason: Agent crashed with SIGKILL");
    expect(exitCode).toBe(1);
  });

  it("struggle/stall/timeout/aborted exits each print ✗ header and exit code 1", () => {
    const failureReasons: LoopExitReason[] = [
      "struggle",
      "stall",
      "timeout",
      "aborted",
    ];
    for (const reason of failureReasons) {
      const { stdout, exitCode } = renderSummary(makeResult(reason));
      expect(stdout).toContain("✗ Autopilot failed");
      expect(exitCode).toBe(1);
    }
  });

  it("failure exit with empty message omits Reason line but still exits 1", () => {
    const { stdout, exitCode } = renderSummary(makeResult("error", ""));
    expect(stdout).toContain("✗ Autopilot failed");
    expect(stdout).not.toContain("Reason:");
    expect(exitCode).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Partition uses imported SUCCESS_REASONS
  // ---------------------------------------------------------------------------

  it("summary partition uses imported SUCCESS_REASONS, not a string literal", () => {
    expect(isSuccessExitReason("sentinel")).toBe(true);
    expect(isSuccessExitReason("idle")).toBe(true);
    expect(isSuccessExitReason("max-iterations")).toBe(false);
    expect(isSuccessExitReason("error")).toBe(false);
    expect(isSuccessExitReason("struggle")).toBe(false);
    expect(isSuccessExitReason("kill-switch")).toBe(false);

    const successReasons: LoopExitReason[] = ["sentinel", "idle"];
    for (const r of successReasons) {
      const { exitCode } = renderSummary(makeResult(r));
      expect(exitCode).toBe(0);
      expect(isSuccessExitReason(r)).toBe(true);
    }

    const failureReasons: LoopExitReason[] = [
      "error",
      "struggle",
      "stall",
      "timeout",
      "aborted",
      "max-iterations",
    ];
    for (const r of failureReasons) {
      const { exitCode } = renderSummary(makeResult(r));
      expect(exitCode).toBe(1);
      expect(isSuccessExitReason(r)).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // Plan and Result lines always present
  // ---------------------------------------------------------------------------

  it("always prints Plan: and Result: lines", () => {
    const { stdout } = renderSummary(makeResult("sentinel", "", 5, 0.12));
    expect(stdout).toContain("Plan:");
    expect(stdout).toContain("Result:");
    expect(stdout).toContain("/plans/my-plan");
    expect(stdout).toContain("sentinel");
    expect(stdout).toContain("5 iteration");
  });
});
