import { describe, test, expect } from "bun:test";
import path from "node:path";
import os from "node:os";
import { resolveClaudeDir } from "./install-skills.js";

describe("resolveClaudeDir", () => {
  test("user scope returns ~/.claude", () => {
    const result = resolveClaudeDir("user");
    expect(result).toBe(path.join(os.homedir(), ".claude"));
  });

  test("project scope returns gitRoot/.claude", () => {
    const result = resolveClaudeDir("project", () => "/tmp/repo");
    expect(result).toBe("/tmp/repo/.claude");
  });

  test("project scope throws when not in git repo", () => {
    expect(() =>
      resolveClaudeDir("project", () => {
        throw new Error("not a git repo");
      }),
    ).toThrow();
  });
});
