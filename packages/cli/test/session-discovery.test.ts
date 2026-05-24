/**
 * Tests for discoverSessions — scanning directories for autopilot event files.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverSessions } from "../src/session-discovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeEventFile(dir: string, events: object[]): string {
  const agentDir = path.join(dir, ".agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const filePath = path.join(agentDir, "autopilot-events.jsonl");
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(filePath, content);
  return filePath;
}

function makeSessionStart(planPath = "/plans/main.md", timestamp?: string) {
  return {
    type: "session:start",
    timestamp: timestamp ?? new Date().toISOString(),
    planPath,
    cwd: "/repo",
    resume: false,
  };
}

function makeSessionDone(timestamp?: string) {
  return {
    type: "session:done",
    timestamp: timestamp ?? new Date().toISOString(),
    exitReason: "sentinel",
    iterations: 3,
    message: "Done",
  };
}

function makeIterationDone(iteration: number, timestamp?: string) {
  return {
    type: "iteration:done",
    timestamp: timestamp ?? new Date().toISOString(),
    iteration,
    durationMs: 1000,
    madeProgress: true,
  };
}

/** Returns an ISO timestamp `minutesAgo` minutes in the past. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverSessions", () => {
  let tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-discovery-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  it("returns empty array for empty dirs list", () => {
    expect(discoverSessions([])).toEqual([]);
  });

  it("returns empty array when no .agent/autopilot-events.jsonl exists", () => {
    const dir = makeTmpDir();
    expect(discoverSessions([dir])).toEqual([]);
  });

  it("returns empty array when .agent dir exists but no event file", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".agent"), { recursive: true });
    expect(discoverSessions([dir])).toEqual([]);
  });

  it("returns empty array for non-existent directory", () => {
    expect(discoverSessions(["/nonexistent/path/that/does/not/exist"])).toEqual([]);
  });

  it("discovers a running session", () => {
    const dir = makeTmpDir();
    writeEventFile(dir, [
      makeSessionStart("/plans/foo.md"),
      makeIterationDone(1),
    ]);

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].handle.planPath).toBe("/plans/foo.md");
    expect(sessions[0].handle.status).toBe("running");
    expect(sessions[0].isStale).toBe(false);
  });

  it("discovers a complete session", () => {
    const dir = makeTmpDir();
    writeEventFile(dir, [
      makeSessionStart("/plans/foo.md"),
      makeIterationDone(1),
      makeSessionDone(),
    ]);

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].handle.status).toBe("complete");
    expect(sessions[0].isStale).toBe(false);
  });

  it("marks session as stale when last event > 5 min old and not complete", () => {
    const dir = makeTmpDir();
    const oldTs = minutesAgo(10);
    writeEventFile(dir, [
      makeSessionStart("/plans/foo.md", minutesAgo(15)),
      makeIterationDone(1, oldTs),
    ]);

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].isStale).toBe(true);
    expect(sessions[0].handle.status).toBe("stale");
  });

  it("does NOT mark complete session as stale even if old", () => {
    const dir = makeTmpDir();
    const oldTs = minutesAgo(60);
    writeEventFile(dir, [
      makeSessionStart("/plans/foo.md", minutesAgo(65)),
      makeSessionDone(oldTs),
    ]);

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].isStale).toBe(false);
    expect(sessions[0].handle.status).toBe("complete");
  });

  it("does NOT mark recent running session as stale", () => {
    const dir = makeTmpDir();
    writeEventFile(dir, [
      makeSessionStart("/plans/foo.md"),
      makeIterationDone(1),
    ]);

    const sessions = discoverSessions([dir]);
    expect(sessions[0].isStale).toBe(false);
  });

  it("skips event file with no session:start", () => {
    const dir = makeTmpDir();
    writeEventFile(dir, [makeIterationDone(1)]);

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(0);
  });

  it("skips empty event file", () => {
    const dir = makeTmpDir();
    const agentDir = path.join(dir, ".agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "autopilot-events.jsonl"), "");

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(0);
  });

  it("skips malformed event file (all invalid JSON)", () => {
    const dir = makeTmpDir();
    const agentDir = path.join(dir, ".agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "autopilot-events.jsonl"),
      "not json\nalso not json\n",
    );

    const sessions = discoverSessions([dir]);
    expect(sessions).toHaveLength(0);
  });

  it("discovers sessions from multiple directories", () => {
    const dir1 = makeTmpDir();
    const dir2 = makeTmpDir();

    writeEventFile(dir1, [makeSessionStart("/plans/a.md")]);
    writeEventFile(dir2, [makeSessionStart("/plans/b.md")]);

    const sessions = discoverSessions([dir1, dir2]);
    expect(sessions).toHaveLength(2);
    const planPaths = sessions.map((s) => s.handle.planPath);
    expect(planPaths).toContain("/plans/a.md");
    expect(planPaths).toContain("/plans/b.md");
  });

  it("sorts sessions by most recent activity (newest first)", () => {
    const dir1 = makeTmpDir();
    const dir2 = makeTmpDir();

    // dir1 has older activity
    writeEventFile(dir1, [
      makeSessionStart("/plans/old.md", minutesAgo(10)),
      makeIterationDone(1, minutesAgo(9)),
    ]);

    // dir2 has newer activity
    writeEventFile(dir2, [
      makeSessionStart("/plans/new.md", minutesAgo(2)),
      makeIterationDone(1, minutesAgo(1)),
    ]);

    const sessions = discoverSessions([dir1, dir2]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].handle.planPath).toBe("/plans/new.md");
    expect(sessions[1].handle.planPath).toBe("/plans/old.md");
  });

  it("exposes the eventFilePath", () => {
    const dir = makeTmpDir();
    writeEventFile(dir, [makeSessionStart()]);

    const sessions = discoverSessions([dir]);
    expect(sessions[0].eventFilePath).toBe(
      path.join(dir, ".agent", "autopilot-events.jsonl"),
    );
  });
});
