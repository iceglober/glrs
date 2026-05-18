/**
 * Tests for autopilot checkpoint persistence.
 *
 * DI-based tests verifying:
 *   - writeCheckpoint serializes the full Checkpoint shape
 *   - writeCheckpoint atomically renames a tmp file onto the target
 *   - readCheckpoint returns null on missing / corrupt / wrong-shape input
 *   - deleteCheckpoint is a no-op when the file doesn't exist
 *   - All write/read failures are swallowed (never throws)
 */

import { describe, it, expect } from "bun:test";
import {
  writeCheckpoint,
  readCheckpoint,
  deleteCheckpoint,
  checkpointPath,
  type Checkpoint,
  type CheckpointDeps,
} from "../src/checkpoint.js";

function makeCheckpoint(): Checkpoint {
  return {
    planPath: "/tmp/plans/feat",
    completedPhases: ["wave_1.md", "wave_2.md"],
    totalCostUsd: 1.23,
    totalIterations: 17,
    timestamp: "2026-05-15T12:00:00.000Z",
  };
}

describe("checkpointPath", () => {
  it("computes the correct path under cwd/.agent/", () => {
    expect(checkpointPath("/tmp/repo")).toBe(
      "/tmp/repo/.agent/autopilot-checkpoint.json",
    );
  });
});

describe("writeCheckpoint", () => {
  it("writes serialized JSON via tmp-then-rename", () => {
    const writes: Array<{ p: string; content: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const mkdirs: string[] = [];

    const deps: CheckpointDeps = {
      writeFileSync: (p, content) => writes.push({ p, content }),
      renameSync: (from, to) => renames.push({ from, to }),
      mkdirSync: (p) => mkdirs.push(p),
    };

    const cp = makeCheckpoint();
    writeCheckpoint("/tmp/repo", cp, deps);

    expect(mkdirs).toContain("/tmp/repo/.agent");
    expect(writes).toHaveLength(1);
    // Tmp file path includes pid and random suffix
    expect(writes[0].p).toMatch(
      /\/tmp\/repo\/\.agent\/autopilot-checkpoint\.json\.tmp\.\d+\.[a-z0-9]+/,
    );
    // Content is pretty-printed JSON of the checkpoint
    const parsed = JSON.parse(writes[0].content);
    expect(parsed).toEqual(cp);

    expect(renames).toHaveLength(1);
    expect(renames[0].from).toBe(writes[0].p);
    expect(renames[0].to).toBe(
      "/tmp/repo/.agent/autopilot-checkpoint.json",
    );
  });

  it("swallows write errors and does not throw", () => {
    const deps: CheckpointDeps = {
      mkdirSync: () => {},
      writeFileSync: () => {
        throw new Error("disk full");
      },
      renameSync: () => {},
    };
    expect(() => writeCheckpoint("/tmp/repo", makeCheckpoint(), deps)).not.toThrow();
  });

  it("swallows mkdir errors and does not throw", () => {
    let writeCalled = false;
    const deps: CheckpointDeps = {
      mkdirSync: () => {
        throw new Error("EACCES");
      },
      writeFileSync: () => {
        writeCalled = true;
      },
      renameSync: () => {},
    };
    expect(() => writeCheckpoint("/tmp/repo", makeCheckpoint(), deps)).not.toThrow();
    // mkdir failure means we never even attempt write
    expect(writeCalled).toBe(false);
  });
});

describe("readCheckpoint", () => {
  it("returns the parsed checkpoint when file exists and is valid", () => {
    const cp = makeCheckpoint();
    const deps: CheckpointDeps = {
      readFileSync: () => JSON.stringify(cp),
    };
    expect(readCheckpoint("/tmp/repo", deps)).toEqual(cp);
  });

  it("returns null when file is missing", () => {
    const deps: CheckpointDeps = {
      readFileSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    expect(readCheckpoint("/tmp/repo", deps)).toBeNull();
  });

  it("returns null when file contains invalid JSON", () => {
    const deps: CheckpointDeps = {
      readFileSync: () => "not json {",
    };
    expect(readCheckpoint("/tmp/repo", deps)).toBeNull();
  });

  it("returns null when planPath is missing", () => {
    const deps: CheckpointDeps = {
      readFileSync: () =>
        JSON.stringify({
          completedPhases: [],
          totalCostUsd: 0,
          totalIterations: 0,
          timestamp: "2026-01-01T00:00:00Z",
        }),
    };
    expect(readCheckpoint("/tmp/repo", deps)).toBeNull();
  });

  it("returns null when completedPhases is not an array of strings", () => {
    const deps: CheckpointDeps = {
      readFileSync: () =>
        JSON.stringify({
          planPath: "/x",
          completedPhases: [1, 2, 3],
          totalCostUsd: 0,
          totalIterations: 0,
          timestamp: "2026-01-01T00:00:00Z",
        }),
    };
    expect(readCheckpoint("/tmp/repo", deps)).toBeNull();
  });

  it("returns null when numeric fields have wrong type", () => {
    const deps: CheckpointDeps = {
      readFileSync: () =>
        JSON.stringify({
          planPath: "/x",
          completedPhases: [],
          totalCostUsd: "not a number",
          totalIterations: 0,
          timestamp: "2026-01-01T00:00:00Z",
        }),
    };
    expect(readCheckpoint("/tmp/repo", deps)).toBeNull();
  });

  it("returns null for null / non-object root", () => {
    const dn: CheckpointDeps = { readFileSync: () => "null" };
    expect(readCheckpoint("/tmp/repo", dn)).toBeNull();
    const da: CheckpointDeps = { readFileSync: () => "[]" };
    expect(readCheckpoint("/tmp/repo", da)).toBeNull();
  });
});

describe("deleteCheckpoint", () => {
  it("calls unlinkSync when file exists", () => {
    const unlinks: string[] = [];
    const deps: CheckpointDeps = {
      existsSync: () => true,
      unlinkSync: (p) => unlinks.push(p),
    };
    deleteCheckpoint("/tmp/repo", deps);
    expect(unlinks).toEqual(["/tmp/repo/.agent/autopilot-checkpoint.json"]);
  });

  it("is a no-op when file does not exist", () => {
    const unlinks: string[] = [];
    const deps: CheckpointDeps = {
      existsSync: () => false,
      unlinkSync: (p) => unlinks.push(p),
    };
    deleteCheckpoint("/tmp/repo", deps);
    expect(unlinks).toEqual([]);
  });

  it("swallows unlink errors", () => {
    const deps: CheckpointDeps = {
      existsSync: () => true,
      unlinkSync: () => {
        throw new Error("EBUSY");
      },
    };
    expect(() => deleteCheckpoint("/tmp/repo", deps)).not.toThrow();
  });
});
