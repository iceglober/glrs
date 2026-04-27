import { describe, it, expect } from "bun:test";
import { createCommands } from "../src/commands/index.js";

describe("research command", () => {
  it("registers /research command", () => {
    const cmds = createCommands();
    expect(cmds["research"]).toBeDefined();
  });

  it("research command prompt contains $ARGUMENTS exactly once", () => {
    const t = createCommands()["research"]!.template as string;
    const matches = (t.match(/\$ARGUMENTS/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it("research command prompt delegates to @research agent", () => {
    expect(createCommands()["research"]!.template).toContain("@research");
  });

  it("research command prompt is under 50 lines", () => {
    expect((createCommands()["research"]!.template as string).split("\n").length).toBeLessThan(50);
  });

  it("research command prompt does not contain old inline-orchestrator language", () => {
    expect(createCommands()["research"]!.template).not.toContain("Launch ALL independent explorations in a SINGLE message");
  });
});
