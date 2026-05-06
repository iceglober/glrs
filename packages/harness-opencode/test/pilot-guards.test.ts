/**
 * Tests for pilot v2 runtime guards (pilot-plugin.ts).
 */

import { describe, test, expect } from "bun:test";
import pilotPlugin from "../src/plugins/pilot-plugin.js";

// Minimal fake plugin input
function makeInput(sessionTitle?: string) {
  return {
    client: {
      session: {
        get: async (_opts: { sessionID: string }) => ({
          title: sessionTitle ?? "",
        }),
      },
    },
    directory: "/tmp/test",
  } as unknown as Parameters<typeof pilotPlugin>[0];
}

describe("pilot-plugin — runtime guards", () => {
  test("non-pilot sessions pass through (no enforcement)", async () => {
    const hooks = await pilotPlugin(makeInput("some-other-session"));
    const before = hooks["tool.execute.before"];
    expect(before).toBeDefined();

    // Should not throw for any command in a non-pilot session
    await expect(
      before!({ sessionID: "ses_abc", tool: "bash", args: { command: "git commit -m test" } } as any, {} as any),
    ).resolves.toBeUndefined();
  });

  test("denies git commit for builder session", async () => {
    const hooks = await pilotPlugin(makeInput("pilot/wf-123/execute/TASK-1"));
    const before = hooks["tool.execute.before"];

    await expect(
      before!({ sessionID: "ses_abc", tool: "bash", args: { command: "git commit -m 'test'" } } as any, {} as any),
    ).rejects.toThrow("not allowed");
  });

  test("denies git push for builder session", async () => {
    const hooks = await pilotPlugin(makeInput("pilot/wf-123/execute/TASK-1"));
    const before = hooks["tool.execute.before"];

    await expect(
      before!({ sessionID: "ses_abc", tool: "bash", args: { command: "git push origin main" } } as any, {} as any),
    ).rejects.toThrow("not allowed");
  });

  test("allows normal bash commands for builder session", async () => {
    const hooks = await pilotPlugin(makeInput("pilot/wf-123/execute/TASK-1"));
    const before = hooks["tool.execute.before"];

    await expect(
      before!({ sessionID: "ses_abc", tool: "bash", args: { command: "bun test" } } as any, {} as any),
    ).resolves.toBeUndefined();
  });

  test("non-execute phases are not restricted", async () => {
    const hooks = await pilotPlugin(makeInput("pilot/wf-123/assess/check"));
    const before = hooks["tool.execute.before"];

    // Assessor can run git commands (for reading diff etc.)
    await expect(
      before!({ sessionID: "ses_abc", tool: "bash", args: { command: "git diff HEAD~1" } } as any, {} as any),
    ).resolves.toBeUndefined();
  });
});
