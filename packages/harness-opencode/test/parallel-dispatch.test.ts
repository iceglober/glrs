import { describe, it, expect, beforeEach } from "bun:test";
import pluginFactory from "../src/plugins/parallel-dispatch.js";

async function getHook() {
  const hooks = await (pluginFactory as any)();
  return hooks["tool.execute.after"]! as (
    input: { tool: string; args: unknown; sessionID: string },
    output: { output: string },
  ) => Promise<void>;
}

function buildInput(
  sessionID: string,
  agent = "build",
): { tool: string; args: unknown; sessionID: string } {
  return { tool: "task", args: { agent, prompt: "implement phase_1" }, sessionID };
}

function nonBuildInput(sessionID: string): {
  tool: string;
  args: unknown;
  sessionID: string;
} {
  return { tool: "task", args: { agent: "code-searcher", prompt: "find files" }, sessionID };
}

describe("parallel-dispatch hook", () => {
  let hook: Awaited<ReturnType<typeof getHook>>;

  beforeEach(async () => {
    hook = await getHook();
  });

  it("injects guidance on a single @build dispatch", async () => {
    const output = { output: "task completed" };
    await hook(buildInput("sess-1"), output);
    expect(output.output).toContain("[PARALLEL DISPATCH REMINDER]");
  });

  it("does not inject guidance on non-build task calls", async () => {
    const output = { output: "search results" };
    await hook(nonBuildInput("sess-2"), output);
    expect(output.output).not.toContain("[PARALLEL DISPATCH REMINDER]");
  });

  it("does not inject guidance on non-task tools", async () => {
    const output = { output: "file contents" };
    await hook({ tool: "read", args: {}, sessionID: "sess-3" }, output);
    expect(output.output).not.toContain("[PARALLEL DISPATCH REMINDER]");
  });

  it("suppresses guidance when multiple @build calls arrive within 5s", async () => {
    const out1 = { output: "build 1 done" };
    const out2 = { output: "build 2 done" };
    const out3 = { output: "build 3 done" };

    await hook(buildInput("sess-4"), out1);
    await hook(buildInput("sess-4"), out2);
    await hook(buildInput("sess-4"), out3);

    expect(out1.output).toContain("[PARALLEL DISPATCH REMINDER]");
    expect(out2.output).not.toContain("[PARALLEL DISPATCH REMINDER]");
    expect(out3.output).not.toContain("[PARALLEL DISPATCH REMINDER]");
  });

  it("isolates state across sessions", async () => {
    const outA = { output: "done" };
    const outB = { output: "done" };

    await hook(buildInput("sess-A"), outA);
    await hook(buildInput("sess-B"), outB);

    expect(outA.output).toContain("[PARALLEL DISPATCH REMINDER]");
    expect(outB.output).toContain("[PARALLEL DISPATCH REMINDER]");
  });

  it("detects @build via agent='@build' prefix", async () => {
    const output = { output: "done" };
    await hook(buildInput("sess-5", "@build"), output);
    expect(output.output).toContain("[PARALLEL DISPATCH REMINDER]");
  });

  it("detects @build via prompt mention", async () => {
    const output = { output: "done" };
    await hook(
      { tool: "task", args: { prompt: "dispatch @build for phase_2" }, sessionID: "sess-6" },
      output,
    );
    expect(output.output).toContain("[PARALLEL DISPATCH REMINDER]");
  });
});
