/**
 * Regression tests for two runtime bugs found by sandboxed harness runs
 * (2026-06-11), both invisible to unit tests that call sub-plugin internals
 * directly:
 *
 * 1. `toolHooks["tool.execute.before"]` was never chained in the plugin
 *    entry's before-hook — the sandbox denylist, the foreground-sleep guard,
 *    and the in-flight subagent counter were all dead at runtime. A sandboxed
 *    run's `linear_save_issue` deny silently no-oped (the mutation executed).
 *
 * 2. `tool.execute.after` hashed `output.output` unconditionally for the
 *    identical-result loop signal; MCP tools can reach the hook with a
 *    non-string output, and `crypto.update(undefined)` throws — a throw from
 *    the after-hook surfaces to the model as the TOOL failing ("The \"data\"
 *    argument must be of type string... Received undefined" on every
 *    linear_* call).
 *
 * Both tests drive the REAL assembled plugin entry, not sub-plugin internals.
 */

import { describe, it, expect, afterEach } from "bun:test";
import plugin from "../src/index.js";

const fakeInput = {
  client: { tui: { showToast: async () => {} } },
  project: { id: "test", worktree: "/tmp/x", vcsDir: "/tmp/x" },
  directory: "/tmp/x",
  worktree: "/tmp/x",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: null,
};

async function buildHooks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await plugin(fakeInput as any, {} as any)) as Record<string, any>;
}

afterEach(() => {
  delete process.env["GLRS_TOOL_DENYLIST"];
});

describe("plugin entry before-hook chain", () => {
  it("tool-hooks' before-hook is reachable: GLRS_TOOL_DENYLIST denies through the assembled plugin", async () => {
    const hooks = await buildHooks();
    process.env["GLRS_TOOL_DENYLIST"] = "linear_save_issue,linear_create_*";

    await expect(
      hooks["tool.execute.before"](
        { sessionID: "ses_chain", tool: "linear_save_issue" },
        { args: {} },
      ),
    ).rejects.toThrow(/disabled in this sandbox/);

    // Non-matching tools pass through.
    await hooks["tool.execute.before"](
      { sessionID: "ses_chain", tool: "linear_get_issue" },
      { args: {} },
    );
  });

  it("foreground-sleep guard is reachable through the assembled plugin", async () => {
    const hooks = await buildHooks();
    await expect(
      hooks["tool.execute.before"](
        { sessionID: "ses_sleep", tool: "bash" },
        { args: { command: "sleep 180 && check-thing" } },
      ),
    ).rejects.toThrow(/Blocked: foreground/);
  });
});

describe("plugin entry after-hook resilience", () => {
  it("tolerates MCP tools with a non-string output (no crypto throw)", async () => {
    const hooks = await buildHooks();
    // Before the fix this threw 'The "data" argument must be of type string…'
    // for every MCP tool whose after-hook output was undefined.
    const output: { output?: string; metadata?: unknown } = { output: undefined };
    await hooks["tool.execute.after"](
      { sessionID: "ses_undef", tool: "linear_get_issue", args: { id: "GEN-1" } },
      output,
    );
  });
});
