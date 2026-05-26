import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import pluginFactory from "../src/plugins/parallel-dispatch.js";
import * as telemetry from "../src/telemetry.js";

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

describe("parallel-dispatch telemetry", () => {
  let hook: Awaited<ReturnType<typeof getHook>>;
  const calls: Array<[string, Record<string, unknown>]> = [];

  beforeEach(async () => {
    hook = await getHook();
    calls.length = 0;
    spyOn(telemetry, "track").mockImplementation(((name: string, props: Record<string, unknown>) => {
      calls.push([name, props]);
    }) as typeof telemetry.track);
  });

  it("emits subagent.dispatch.serial for a single @build batch", async () => {
    await hook(buildInput("telem-1"), { output: "" });
    expect(calls).toHaveLength(0);

    const original = Date.now;
    Date.now = () => original() + 6000;
    await hook(buildInput("telem-1"), { output: "" });
    Date.now = original;

    expect(calls).toEqual([["subagent.dispatch.serial", { ops_count: 1 }]]);
  });

  it("emits subagent.dispatch.parallel for batched @build calls", async () => {
    await hook(buildInput("telem-2"), { output: "" });
    await hook(buildInput("telem-2"), { output: "" });
    await hook(buildInput("telem-2"), { output: "" });

    const callsBefore = calls.length;

    const original = Date.now;
    Date.now = () => original() + 6000;
    await hook(buildInput("telem-2"), { output: "" });
    Date.now = original;

    const newCalls = calls.slice(callsBefore);
    expect(newCalls).toEqual([["subagent.dispatch.parallel", { ops_count: 3 }]]);
  });
});
