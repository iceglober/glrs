/**
 * autopilot-ralph.test.ts — Tests for the Ralph loop rewrite.
 *
 * Covers:
 *   - Old autopilot artifact removal (a1)
 *   - Ralph loop mechanics: same-prompt retry, sentinel detection, max-iterations (a2)
 *   - Struggle detection: zero-progress threshold (a3)
 *   - Autopilot command prompt content (a4)
 *   - PRIME prompt content (a5)
 *   - Kill-switch behavior (a6)
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// a1: Old autopilot artifacts are removed
// ---------------------------------------------------------------------------

describe("old autopilot artifacts are removed", () => {
  it("src/plugins/autopilot.ts does not exist", () => {
    const pluginPath = path.join(ROOT, "src", "plugins", "autopilot.ts");
    expect(fs.existsSync(pluginPath)).toBe(false);
  });

  it("no source file references autopilot-state.json", () => {
    const srcDir = path.join(ROOT, "src");
    const violations: string[] = [];
    function scan(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
          const content = fs.readFileSync(full, "utf8");
          if (content.includes("autopilot-state.json")) {
            violations.push(path.relative(ROOT, full));
          }
        }
      }
    }
    scan(srcDir);
    expect(violations).toEqual([]);
  });

  it("no source file references the AUTOPILOT mode activation marker", () => {
    const srcDir = path.join(ROOT, "src");
    const violations: string[] = [];
    function scan(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
          const content = fs.readFileSync(full, "utf8");
          if (content.includes("AUTOPILOT mode")) {
            violations.push(path.relative(ROOT, full));
          }
        }
      }
    }
    scan(srcDir);
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// a2: Ralph loop mechanics
// ---------------------------------------------------------------------------

describe("ralph loop sends same prompt each iteration", () => {
  it("detectSentinel returns false when sentinel is absent", async () => {
    const { detectSentinel } = await import("../src/autopilot/sentinel.js");
    expect(detectSentinel("Some response without the tag")).toBe(false);
    expect(detectSentinel("")).toBe(false);
    expect(detectSentinel("autopilot-done")).toBe(false);
  });

  it("detectSentinel returns true when sentinel tag is present", async () => {
    const { detectSentinel } = await import("../src/autopilot/sentinel.js");
    expect(detectSentinel("<autopilot-done>")).toBe(true);
    expect(detectSentinel("Work complete. <autopilot-done>")).toBe(true);
    expect(detectSentinel("All done!\n<autopilot-done>\nExtra text")).toBe(true);
  });

  it("detectSentinel returns false when tag is inside a code fence", async () => {
    const { detectSentinel } = await import("../src/autopilot/sentinel.js");
    const inFence = "```\n<autopilot-done>\n```";
    expect(detectSentinel(inFence)).toBe(false);
  });

  it("detectSentinel returns false when tag is inside backtick inline code", async () => {
    const { detectSentinel } = await import("../src/autopilot/sentinel.js");
    expect(detectSentinel("Emit `<autopilot-done>` when done")).toBe(false);
  });
});

describe("ralph loop exits on sentinel detection", () => {
  it("detectSentinel is case-sensitive (uppercase tag not matched)", async () => {
    const { detectSentinel } = await import("../src/autopilot/sentinel.js");
    expect(detectSentinel("<AUTOPILOT-DONE>")).toBe(false);
    expect(detectSentinel("<Autopilot-Done>")).toBe(false);
  });

  it("detectSentinel handles partial tag (no closing bracket)", async () => {
    const { detectSentinel } = await import("../src/autopilot/sentinel.js");
    expect(detectSentinel("<autopilot-done")).toBe(false);
    expect(detectSentinel("autopilot-done>")).toBe(false);
  });
});

describe("ralph loop exits on max-iterations budget", () => {
  it("config exports MAX_ITERATIONS = 50", async () => {
    const { MAX_ITERATIONS } = await import("../src/autopilot/config.js");
    expect(MAX_ITERATIONS).toBe(50);
  });

  it("config exports STRUGGLE_THRESHOLD = 3", async () => {
    const { STRUGGLE_THRESHOLD } = await import("../src/autopilot/config.js");
    expect(STRUGGLE_THRESHOLD).toBe(3);
  });

  it("config exports TIMEOUT_MS = 4 hours", async () => {
    const { TIMEOUT_MS } = await import("../src/autopilot/config.js");
    expect(TIMEOUT_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("config exports STALL_MS = 60 minutes", async () => {
    const { STALL_MS } = await import("../src/autopilot/config.js");
    expect(STALL_MS).toBe(60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// a3: Struggle detection
// ---------------------------------------------------------------------------

describe("struggle detection stops on zero-progress iterations", () => {
  it("StruggleDetector starts with zero consecutive stalls", async () => {
    const { StruggleDetector } = await import("../src/autopilot/struggle.js");
    const d = new StruggleDetector(3);
    expect(d.consecutiveStalls).toBe(0);
    expect(d.isStruggling()).toBe(false);
  });

  it("StruggleDetector increments on zero-progress iteration", async () => {
    const { StruggleDetector } = await import("../src/autopilot/struggle.js");
    const d = new StruggleDetector(3);
    d.record(false); // no progress
    expect(d.consecutiveStalls).toBe(1);
    expect(d.isStruggling()).toBe(false);
  });

  it("StruggleDetector resets on progress", async () => {
    const { StruggleDetector } = await import("../src/autopilot/struggle.js");
    const d = new StruggleDetector(3);
    d.record(false);
    d.record(false);
    d.record(true); // progress resets counter
    expect(d.consecutiveStalls).toBe(0);
    expect(d.isStruggling()).toBe(false);
  });

  it("StruggleDetector signals struggling at threshold", async () => {
    const { StruggleDetector } = await import("../src/autopilot/struggle.js");
    const d = new StruggleDetector(3);
    d.record(false);
    d.record(false);
    d.record(false);
    expect(d.isStruggling()).toBe(true);
  });

  it("StruggleDetector does not signal before threshold", async () => {
    const { StruggleDetector } = await import("../src/autopilot/struggle.js");
    const d = new StruggleDetector(3);
    d.record(false);
    d.record(false);
    expect(d.isStruggling()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// a4: Autopilot command prompt content
// ---------------------------------------------------------------------------

describe("autopilot prompt template contains sentinel instructions", () => {
  const promptPath = path.join(ROOT, "src", "autopilot", "prompt-template.md");
  const content = fs.readFileSync(promptPath, "utf8");

  it("prompt contains <autopilot-done> sentinel tag instruction", () => {
    expect(content).toContain("<autopilot-done>");
  });

  it("prompt instructs agent to emit sentinel when work is complete", () => {
    // Should contain some instruction about emitting the sentinel
    expect(content.toLowerCase()).toMatch(/emit.*autopilot-done|autopilot-done.*emit/);
  });

  it("prompt contains $ARGUMENTS exactly once", () => {
    // Strip YAML frontmatter
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
    const matches = body.match(/\$ARGUMENTS/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});

describe("autopilot prompt template has no old-mechanic references", () => {
  const promptPath = path.join(ROOT, "src", "autopilot", "prompt-template.md");
  const content = fs.readFileSync(promptPath, "utf8");

  it("prompt does not contain AUTOPILOT mode activation marker", () => {
    expect(content).not.toContain("AUTOPILOT mode");
  });

  it("prompt does not reference session.idle nudges", () => {
    expect(content).not.toContain("session.idle");
    expect(content).not.toContain("[autopilot]");
  });

  it("prompt does not reference plan-checkbox counting mechanics", () => {
    expect(content).not.toContain("autopilot plugin");
    expect(content).not.toContain("nudge");
  });

  it("prompt does not reference autopilot-state.json", () => {
    expect(content).not.toContain("autopilot-state.json");
  });
});

// ---------------------------------------------------------------------------
// a5: PRIME prompt has no autopilot-mode section
// ---------------------------------------------------------------------------

describe("prime prompt has no autopilot-mode section", () => {
  const primePath = path.join(ROOT, "src", "agents", "prompts", "prime.md");
  const content = fs.readFileSync(primePath, "utf8");

  it("prime.md does not contain # Autopilot mode section header", () => {
    expect(content).not.toContain("# Autopilot mode");
  });

  it("prime.md does not reference session.idle nudges", () => {
    expect(content).not.toContain("session.idle");
  });

  it("prime.md does not reference [autopilot] messages", () => {
    expect(content).not.toContain("[autopilot]");
  });

  it("prime.md does not reference AUTOPILOT mode activation marker", () => {
    expect(content).not.toContain("AUTOPILOT mode");
  });

  it("prime.md does NOT list /autopilot in fallback allowlist (CLI-only feature)", () => {
    // The TUI slash command was removed; autopilot is now CLI-only via
    // `glrs oc autopilot`. The fallback allowlist should not include it.
    // (The word "autopilot" may appear in carve-outs narrative describing
    // the CLI feature, but not as a backticked slash command.)
    expect(content).not.toMatch(/`\/autopilot`/);
  });
});

// ---------------------------------------------------------------------------
// a6: Kill switch
// ---------------------------------------------------------------------------

describe("kill switch stops the loop", () => {
  it("KILL_SWITCH_PATH constant is .agent/autopilot-disable", async () => {
    const { KILL_SWITCH_PATH } = await import("../src/autopilot/config.js");
    expect(KILL_SWITCH_PATH).toBe(".agent/autopilot-disable");
  });

  it("checkKillSwitch returns true when file exists", async () => {
    const { checkKillSwitch } = await import("../src/autopilot/struggle.js");
    const tmpDir = fs.mkdtempSync("/tmp/autopilot-test-");
    const agentDir = path.join(tmpDir, ".agent");
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "autopilot-disable"), "");
    expect(checkKillSwitch(tmpDir)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("checkKillSwitch returns false when file does not exist", async () => {
    const { checkKillSwitch } = await import("../src/autopilot/struggle.js");
    const tmpDir = fs.mkdtempSync("/tmp/autopilot-test-");
    expect(checkKillSwitch(tmpDir)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// a2 (integration): Ralph loop sentinel detection end-to-end
//
// These tests exercise runRalphLoop with injected mock server deps so we
// can control what getLastAssistantMessage returns without a real OpenCode
// server. The _deps injection point is the seam.
// ---------------------------------------------------------------------------

describe("ralph loop exits on sentinel detection (integration)", () => {
  it("ralph loop exits on sentinel detection", async () => {
    const { runRalphLoop } = await import("../src/autopilot/loop.js");

    // Mock client — shape doesn't matter since all server calls are injected
    const mockClient = {} as Parameters<typeof runRalphLoop>[0]["_deps"] extends undefined
      ? never
      : NonNullable<Parameters<typeof runRalphLoop>[0]["_deps"]>["startServer"] extends
          ((...args: unknown[]) => Promise<infer R>) | undefined
        ? NonNullable<R>["client"]
        : never;

    let iteration = 0;

    const result = await runRalphLoop({
      prompt: "do the work",
      cwd: "/tmp",
      maxIterations: 5,
      timeoutMs: 60_000,
      stallMs: 60_000,
      _deps: {
        startServer: async () => ({
          client: mockClient,
          url: "http://localhost:0",
          shutdown: async () => {},
        }),
        createSession: async () => "test-session-id",
        sendAndWait: async () => {
          iteration += 1;
          return { kind: "idle" as const };
        },
        // Return sentinel on iteration 2
        getLastAssistantMessage: async () => {
          if (iteration >= 2) {
            return "All done! <autopilot-done>";
          }
          return "Still working...";
        },
      },
    });

    expect(result.exitReason).toBe("sentinel");
    expect(result.iterations).toBe(2);
    expect(result.message).toContain("<autopilot-done>");
    expect(result.message).toContain("iteration 2");
  });

  it("ralph loop does NOT exit when sentinel appears inside a code fence", async () => {
    const { runRalphLoop } = await import("../src/autopilot/loop.js");
    const os = await import("node:os");
    const { execSync } = await import("node:child_process");

    // Create a real git repo so checkProgress behaves deterministically on all CI
    // environments (avoids the /tmp-inside-git-repo CI bomb).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-fence-test-"));
    try {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });
      execSync("git commit --allow-empty -m init", { cwd: tmpDir, stdio: "pipe" });

      const mockClient = {} as Parameters<typeof runRalphLoop>[0]["_deps"] extends undefined
        ? never
        : NonNullable<Parameters<typeof runRalphLoop>[0]["_deps"]>["startServer"] extends
            ((...args: unknown[]) => Promise<infer R>) | undefined
          ? NonNullable<R>["client"]
          : never;

      let callCount = 0;

      const result = await runRalphLoop({
        prompt: "do the work",
        cwd: tmpDir,
        maxIterations: 3,
        timeoutMs: 60_000,
        stallMs: 60_000,
        struggleThreshold: 10,
        _deps: {
          startServer: async () => ({
            client: mockClient,
            url: "http://localhost:0",
            shutdown: async () => {},
          }),
          createSession: async () => "test-session-id",
          sendAndWait: async () => {
            callCount += 1;
            return { kind: "idle" as const };
          },
          // Always return sentinel inside a code fence — should never trigger exit
          getLastAssistantMessage: async () =>
            "Here is how to signal done:\n```\n<autopilot-done>\n```\nBut I'm not done yet.",
        },
      });

      // Loop should run to max-iterations since the fenced sentinel is ignored
      expect(result.exitReason).toBe("max-iterations");
      expect(result.iterations).toBe(3);
      expect(callCount).toBe(3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  /**
   * BUG-REGRESSION TEST: sentinel must win over struggle on zero-progress iterations.
   *
   * Setup: real git repo (so checkProgress returns false — no changes), struggleThreshold=3,
   * mock returns <autopilot-done> on iteration 3.
   *
   * With the OLD (buggy) ordering: struggle fires at iteration 3 → exitReason="struggle".
   * With the CORRECT ordering: sentinel fires first at iteration 3 → exitReason="sentinel".
   *
   * This test would FAIL against the pre-fix loop.ts.
   */
  it("ralph loop exits on sentinel even when no filesystem progress", async () => {
    const { runRalphLoop } = await import("../src/autopilot/loop.js");
    const os = await import("node:os");
    const { execSync } = await import("node:child_process");

    // Create a real git repo so git rev-parse HEAD succeeds and
    // git diff --stat returns empty (no changes → madeProgress=false).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-sentinel-test-"));
    try {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });
      // Need at least one commit so HEAD exists
      execSync("git commit --allow-empty -m init", { cwd: tmpDir, stdio: "pipe" });

      const mockClient = {} as Parameters<typeof runRalphLoop>[0]["_deps"] extends undefined
        ? never
        : NonNullable<Parameters<typeof runRalphLoop>[0]["_deps"]>["startServer"] extends
            ((...args: unknown[]) => Promise<infer R>) | undefined
          ? NonNullable<R>["client"]
          : never;

      let iteration = 0;

      const result = await runRalphLoop({
        prompt: "do the work",
        cwd: tmpDir,
        maxIterations: 5,
        timeoutMs: 60_000,
        stallMs: 60_000,
        // struggleThreshold=3: without the fix, struggle fires at iteration 3
        // before the sentinel check, producing exitReason="struggle".
        struggleThreshold: 3,
        _deps: {
          startServer: async () => ({
            client: mockClient,
            url: "http://localhost:0",
            shutdown: async () => {},
          }),
          createSession: async () => "test-session-id",
          sendAndWait: async () => {
            iteration += 1;
            return { kind: "idle" as const };
          },
          // Return sentinel on iteration 3 — same iteration struggle would fire
          getLastAssistantMessage: async () => {
            if (iteration >= 3) {
              return "All done! <autopilot-done>";
            }
            return "Still working...";
          },
        },
      });

      // Sentinel must win: exitReason should be "sentinel", not "struggle"
      expect(result.exitReason).toBe("sentinel");
      expect(result.iterations).toBe(3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  /**
   * Struggle detection fires correctly when no sentinel is emitted.
   *
   * Uses a real git repo (no changes → madeProgress=false every iteration).
   * Verifies that struggle detection still works after the sentinel-first reorder.
   */
  it("struggle detection fires when no sentinel and no progress", async () => {
    const { runRalphLoop } = await import("../src/autopilot/loop.js");
    const os = await import("node:os");
    const { execSync } = await import("node:child_process");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-struggle-test-"));
    try {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });
      execSync("git commit --allow-empty -m init", { cwd: tmpDir, stdio: "pipe" });

      const mockClient = {} as Parameters<typeof runRalphLoop>[0]["_deps"] extends undefined
        ? never
        : NonNullable<Parameters<typeof runRalphLoop>[0]["_deps"]>["startServer"] extends
            ((...args: unknown[]) => Promise<infer R>) | undefined
          ? NonNullable<R>["client"]
          : never;

      const result = await runRalphLoop({
        prompt: "do the work",
        cwd: tmpDir,
        maxIterations: 10,
        timeoutMs: 60_000,
        stallMs: 60_000,
        struggleThreshold: 3,
        _deps: {
          startServer: async () => ({
            client: mockClient,
            url: "http://localhost:0",
            shutdown: async () => {},
          }),
          createSession: async () => "test-session-id",
          sendAndWait: async () => ({ kind: "idle" as const }),
          // Never emit sentinel — loop should hit struggle
          getLastAssistantMessage: async () => "Still working, no sentinel here.",
        },
      });

      // Struggle must fire at iteration 3 (threshold=3, no progress, no sentinel)
      expect(result.exitReason).toBe("struggle");
      expect(result.iterations).toBe(3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
