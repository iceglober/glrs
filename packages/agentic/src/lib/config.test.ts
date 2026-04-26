import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { worktreePath, worktreesRoot } from "./config.js";

describe("worktree storage paths", () => {
  const originalEnv = process.env.GLORIOUS_DIR;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GLORIOUS_DIR;
    else process.env.GLORIOUS_DIR = originalEnv;
  });

  describe("default (no GLORIOUS_DIR)", () => {
    beforeEach(() => {
      delete process.env.GLORIOUS_DIR;
    });

    it("places worktrees under ~/.glorious/worktrees/<repo>/<name>", () => {
      expect(worktreePath("feat-x", "my-repo")).toBe(
        path.join(os.homedir(), ".glorious", "worktrees", "my-repo", "feat-x"),
      );
    });

    it("worktreesRoot returns ~/.glorious/worktrees/<repo>", () => {
      expect(worktreesRoot("my-repo")).toBe(
        path.join(os.homedir(), ".glorious", "worktrees", "my-repo"),
      );
    });
  });

  describe("with GLORIOUS_DIR override", () => {
    beforeEach(() => {
      process.env.GLORIOUS_DIR = "/tmp/glorious-test";
    });

    it("places worktrees under $GLORIOUS_DIR/<repo>/<name>", () => {
      expect(worktreePath("feat-x", "my-repo")).toBe(
        "/tmp/glorious-test/my-repo/feat-x",
      );
    });
  });
});
