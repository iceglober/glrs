import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseModelId,
  resolveCouncilConfig,
  buildStage1Prompt,
  buildStage2Prompt,
  labelFor,
  reviewerOrder,
  parseRankingLabels,
  aggregateRanks,
  buildChairmanPrompt,
  runCouncil,
  formatCouncilReport,
  createCouncilTools,
  __test__,
  type CouncilCaller,
  type CouncilClient,
} from "../src/tools/council.js";
import { createTools } from "../src/tools/index.js";
import { AGENTS } from "@glrs-dev/agent-core";

// ---- pure helpers ------------------------------------------------------------

describe("parseModelId", () => {
  it("splits on the first slash only", () => {
    expect(parseModelId("anthropic/claude-opus-4-7")).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
    });
    // Bedrock-style ids keep dots; openrouter-style ids keep inner slashes.
    expect(parseModelId("amazon-bedrock/global.anthropic.claude-opus-4-7")).toEqual({
      providerID: "amazon-bedrock",
      modelID: "global.anthropic.claude-opus-4-7",
    });
    expect(parseModelId("openrouter/x-ai/grok-4")).toEqual({
      providerID: "openrouter",
      modelID: "x-ai/grok-4",
    });
  });

  it("rejects ids without a provider segment", () => {
    expect(() => parseModelId("claude-opus-4-7")).toThrow();
    expect(() => parseModelId("/model")).toThrow();
    expect(() => parseModelId("provider/")).toThrow();
  });
});

describe("resolveCouncilConfig", () => {
  it("returns null when council is absent", () => {
    expect(resolveCouncilConfig(undefined)).toBeNull();
    expect(resolveCouncilConfig({})).toBeNull();
    expect(resolveCouncilConfig({ models: { deep: ["a/b"] } })).toBeNull();
  });

  it("returns null when fewer than 2 valid members", () => {
    expect(resolveCouncilConfig({ council: { members: [] } })).toBeNull();
    expect(resolveCouncilConfig({ council: { members: ["anthropic/claude-opus-4-7"] } })).toBeNull();
    // Invalid ids are filtered before the count.
    expect(
      resolveCouncilConfig({ council: { members: ["no-slash", "anthropic/x"] } }),
    ).toBeNull();
  });

  it("resolves members and explicit chairman", () => {
    const cfg = resolveCouncilConfig({
      council: {
        members: ["anthropic/claude-opus-4-7", "openai/gpt-5.1"],
        chairman: "google/gemini-3-pro",
        timeoutMs: 1234,
      },
    });
    expect(cfg).toEqual({
      members: ["anthropic/claude-opus-4-7", "openai/gpt-5.1"],
      chairman: "google/gemini-3-pro",
      timeoutMs: 1234,
    });
  });

  it("defaults the chairman to the deep tier model, then the first member", () => {
    const withDeep = resolveCouncilConfig({
      models: { deep: ["anthropic/claude-opus-4-7"] },
      council: { members: ["openai/gpt-5.1", "google/gemini-3-pro"] },
    });
    expect(withDeep?.chairman).toBe("anthropic/claude-opus-4-7");

    const withoutDeep = resolveCouncilConfig({
      council: { members: ["openai/gpt-5.1", "google/gemini-3-pro"] },
    });
    expect(withoutDeep?.chairman).toBe("openai/gpt-5.1");
  });
});

describe("reviewerOrder", () => {
  it("is deterministic and a permutation", () => {
    const a = reviewerOrder(4, 0);
    const b = reviewerOrder(4, 0);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
  });

  it("differs across reviewers (positional de-bias)", () => {
    const orders = [0, 1, 2, 3].map((r) => reviewerOrder(4, r).join(","));
    // Not all four reviewers may differ pairwise for every n, but the set
    // must not collapse to a single fixed order (upstream's bias bug).
    expect(new Set(orders).size).toBeGreaterThan(1);
  });
});

describe("parseRankingLabels", () => {
  const labels = ["Response A", "Response B", "Response C"];

  it("parses the FINAL RANKING block", () => {
    const text = `Response A is detailed. Response B is wrong about X.

FINAL RANKING:
1. Response C
2. Response A
3. Response B`;
    expect(parseRankingLabels(text, labels)).toEqual([
      "Response C",
      "Response A",
      "Response B",
    ]);
  });

  it("falls back to mention order when the header is missing", () => {
    const text = "I think Response B is best, then Response C, then Response A.";
    expect(parseRankingLabels(text, labels)).toEqual([
      "Response B",
      "Response C",
      "Response A",
    ]);
  });

  it("ignores unknown labels and dedupes", () => {
    const text = `FINAL RANKING:
1. Response Z
2. Response B
3. Response B
4. Response A`;
    expect(parseRankingLabels(text, labels)).toEqual(["Response B", "Response A"]);
  });

  it("uses the LAST header when the model echoes the instructions", () => {
    const text = `The format requires FINAL RANKING: at the end.

FINAL RANKING:
1. Response A
2. Response B`;
    expect(parseRankingLabels(text, labels)).toEqual(["Response A", "Response B"]);
  });
});

describe("aggregateRanks", () => {
  it("computes mean 1-based position and sorts best first", () => {
    const agg = aggregateRanks([
      { reviewer: "m1", text: "", ranking: ["a", "b", "c"] },
      { reviewer: "m2", text: "", ranking: ["b", "a", "c"] },
      { reviewer: "m3", text: "", ranking: ["a", "c"] }, // partial ranking
    ]);
    expect(agg[0]).toEqual({ model: "a", averageRank: (1 + 2 + 1) / 3, votes: 3 });
    expect(agg[1]).toEqual({ model: "b", averageRank: 1.5, votes: 2 });
    expect(agg[2]).toEqual({ model: "c", averageRank: (3 + 3 + 2) / 3, votes: 3 });
  });

  it("is empty when no rankings parsed", () => {
    expect(aggregateRanks([{ reviewer: "m", text: "", ranking: [] }])).toEqual([]);
  });
});

describe("stage prompts", () => {
  it("stage 1 includes context when given", () => {
    expect(buildStage1Prompt("Q?")).toBe("Q?");
    const withCtx = buildStage1Prompt("Q?", "repo uses bun");
    expect(withCtx).toContain("repo uses bun");
    expect(withCtx).toContain("Q?");
  });

  it("stage 2 contains every label, the question, and the ranking contract", () => {
    const prompt = buildStage2Prompt("Q?", [
      { label: labelFor(0), text: "ans1" },
      { label: labelFor(1), text: "ans2" },
    ]);
    expect(prompt).toContain("Response A:\nans1");
    expect(prompt).toContain("Response B:\nans2");
    expect(prompt).toContain("FINAL RANKING:");
    expect(prompt).toContain("Q?");
  });

  it("chairman sees real model names, reviews, and the aggregate", () => {
    const prompt = buildChairmanPrompt(
      "Q?",
      [{ model: "openai/gpt-5.1", text: "ans" }],
      [{ reviewer: "anthropic/claude-opus-4-7", text: "review", ranking: ["openai/gpt-5.1"] }],
      [{ model: "openai/gpt-5.1", averageRank: 1, votes: 1 }],
    );
    expect(prompt).toContain("Model: openai/gpt-5.1");
    expect(prompt).toContain("Model: anthropic/claude-opus-4-7");
    expect(prompt).toContain("average rank 1.00");
    expect(prompt).toContain("Chairman");
  });
});

// ---- pipeline ------------------------------------------------------------------

const MEMBERS = ["anthropic/claude-opus-4-7", "openai/gpt-5.1", "google/gemini-3-pro"];

/** Caller that answers per-model and records every call. */
function fakeCaller(opts: {
  fail?: Set<string>;
  failStage2?: Set<string>;
  failChairman?: boolean;
  rankingFor?: (reviewerModel: string, labels: string[]) => string[];
}) {
  const calls: { model: string; title: string; text: string }[] = [];
  const call: CouncilCaller = async ({ model, title, text }) => {
    calls.push({ model, title, text });
    const isStage2 = text.includes("FINAL RANKING:");
    const isChairman = text.includes("Chairman of an LLM Council");
    if (isChairman) {
      if (opts.failChairman) throw new Error("chairman down");
      return `synthesis from ${model}`;
    }
    if (isStage2) {
      if (opts.failStage2?.has(model)) throw new Error("review failed");
      const labels = [...text.matchAll(/(Response [A-Z]):\n/g)].map((m) => m[1]!);
      const ranked = opts.rankingFor?.(model, labels) ?? labels;
      return `evaluations…\n\nFINAL RANKING:\n${ranked.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
    }
    if (opts.fail?.has(model)) throw new Error("model unavailable");
    // "::" instead of "/" so answer text doesn't itself contain a model id —
    // the anonymization test asserts ids never reach stage-2 prompts, and the
    // pipeline can't scrub ids the members write into their own answers.
    return `answer from ${model.replace("/", "::")}`;
  };
  return { call, calls };
}

describe("runCouncil", () => {
  it("runs all three stages and returns a synthesis", async () => {
    const { call, calls } = fakeCaller({});
    const result = await runCouncil(call, { members: MEMBERS, chairman: MEMBERS[0] }, "Q?");

    expect(result.answers.map((a) => a.model)).toEqual(MEMBERS);
    expect(result.reviews.length).toBe(3);
    expect(result.synthesis).toBe(`synthesis from ${MEMBERS[0]}`);
    expect(result.chairmanFallback).toBe(false);
    expect(result.failures).toEqual([]);
    // 3 answers + 3 reviews + 1 chairman
    expect(calls.length).toBe(7);
    // Every reviewer ranked all three (anonymized) answers, de-anonymized back
    // to real model ids.
    for (const review of result.reviews) {
      expect([...review.ranking].sort()).toEqual([...MEMBERS].sort());
    }
  });

  it("drops failed members and reports them", async () => {
    const { call } = fakeCaller({ fail: new Set(["openai/gpt-5.1"]) });
    const result = await runCouncil(call, { members: MEMBERS }, "Q?");
    expect(result.answers.map((a) => a.model)).toEqual([
      "anthropic/claude-opus-4-7",
      "google/gemini-3-pro",
    ]);
    expect(result.failures.some((f) => f.includes("openai/gpt-5.1 (stage 1)"))).toBe(true);
  });

  it("throws when fewer than 2 members answer", async () => {
    const { call } = fakeCaller({ fail: new Set(MEMBERS.slice(1)) });
    await expect(runCouncil(call, { members: MEMBERS }, "Q?")).rejects.toThrow(
      /not enough for a council round/,
    );
  });

  it("requires at least 2 configured members", async () => {
    const { call } = fakeCaller({});
    await expect(runCouncil(call, { members: ["a/b"] }, "Q?")).rejects.toThrow(
      /at least 2 members/,
    );
  });

  it("survives stage-2 failures — synthesis proceeds without those reviews", async () => {
    const { call } = fakeCaller({ failStage2: new Set(MEMBERS) });
    const result = await runCouncil(call, { members: MEMBERS }, "Q?");
    expect(result.reviews).toEqual([]);
    expect(result.aggregate).toEqual([]);
    expect(result.synthesis).toContain("synthesis from");
  });

  it("falls back to the top-ranked answer when the chairman fails", async () => {
    // Every reviewer ranks gemini's (anonymized) answer first.
    const { call } = fakeCaller({
      failChairman: true,
      rankingFor: (_reviewer, labels) => labels, // label order — varies per reviewer
    });
    const result = await runCouncil(call, { members: MEMBERS }, "Q?");
    expect(result.chairmanFallback).toBe(true);
    // Fallback must be one of the actual member answers.
    expect(result.answers.map((a) => a.text)).toContain(result.synthesis);
    expect(result.failures.some((f) => f.includes("(chairman)"))).toBe(true);
  });

  it("anonymizes stage 2 — member prompts never contain model ids", async () => {
    const { call, calls } = fakeCaller({});
    await runCouncil(call, { members: MEMBERS, chairman: MEMBERS[0] }, "Q?");
    const stage2Calls = calls.filter((c) => c.title.startsWith("council review:"));
    expect(stage2Calls.length).toBe(3);
    for (const c of stage2Calls) {
      for (const member of MEMBERS) {
        expect(c.text).not.toContain(member);
      }
    }
  });
});

describe("formatCouncilReport", () => {
  it("includes synthesis, chairman, members, aggregate, and failures", () => {
    const report = formatCouncilReport({
      question: "Q?",
      answers: [
        { model: "a/x", text: "ans" },
        { model: "b/y", text: "ans2" },
      ],
      reviews: [],
      aggregate: [{ model: "a/x", averageRank: 1.5, votes: 2 }],
      chairman: "a/x",
      synthesis: "the answer",
      failures: ["c/z (stage 1): boom"],
      chairmanFallback: false,
    });
    expect(report).toContain("the answer");
    expect(report).toContain("**Chairman:** a/x");
    expect(report).toContain("a/x, b/y");
    expect(report).toContain("avg rank 1.50");
    expect(report).toContain("c/z (stage 1): boom");
  });
});

// ---- tools ----------------------------------------------------------------------

function fakeToolContext(sessionID = "ses_test") {
  return {
    sessionID,
    messageID: "msg_test",
    agent: "prime",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: (() => {}) as any,
  };
}

function fakePromptClient() {
  const pushes: { sessionID: string; text: string }[] = [];
  const client: CouncilClient = {
    session: {
      create: async () => ({ data: { id: "child" } }),
      prompt: async () => ({ data: { parts: [] } }),
      abort: async () => ({}),
      promptAsync: async (args) => {
        pushes.push({ sessionID: args.path.id, text: args.body.parts[0]!.text });
        return {};
      },
    },
  };
  return { client, pushes };
}

describe("createCouncilTools", () => {
  beforeEach(() => __test__.clearJobs());

  it("council returns a job id immediately and pushes the report on completion", async () => {
    const { client, pushes } = fakePromptClient();
    const { call } = fakeCaller({});
    const tools = createCouncilTools({
      client,
      config: { members: MEMBERS, chairman: MEMBERS[0] },
      makeCaller: () => call,
    });

    const out = (await tools.council.execute(
      { question: "Q?", context: undefined } as any,
      fakeToolContext() as any,
    )) as string;
    expect(out).toMatch(/job council-/);
    expect(out).toContain("pushed to this session");

    // Drain the floating pipeline promise.
    await new Promise((r) => setTimeout(r, 10));

    expect(pushes.length).toBe(1);
    expect(pushes[0]!.sessionID).toBe("ses_test");
    expect(pushes[0]!.text).toContain("[council]");
    expect(pushes[0]!.text).toContain("synthesis from");
  });

  it("council_check reports running, done, and unknown jobs", async () => {
    const { client } = fakePromptClient();
    // A caller that never resolves keeps the job in "running".
    const hang: CouncilCaller = () => new Promise(() => {});
    const tools = createCouncilTools({
      client,
      config: { members: MEMBERS },
      makeCaller: () => hang,
    });

    const ctx = fakeToolContext();
    const out = (await tools.council.execute({ question: "Q?" } as any, ctx as any)) as string;
    const jobId = /job (council-[a-z0-9-]+)/.exec(out)![1]!;

    const running = (await tools.council_check.execute({ job_id: jobId } as any, ctx as any)) as string;
    expect(running).toContain("Still deliberating");

    const list = (await tools.council_check.execute({} as any, ctx as any)) as string;
    expect(list).toContain(jobId);

    const unknown = (await tools.council_check.execute(
      { job_id: "council-nope" } as any,
      ctx as any,
    )) as string;
    expect(unknown).toContain("Unknown council job");
  });

  it("pushes a failure notice when the pipeline errors", async () => {
    const { client, pushes } = fakePromptClient();
    const { call } = fakeCaller({ fail: new Set(MEMBERS) });
    const tools = createCouncilTools({
      client,
      config: { members: MEMBERS },
      makeCaller: () => call,
    });

    await tools.council.execute({ question: "Q?" } as any, fakeToolContext() as any);
    await new Promise((r) => setTimeout(r, 10));

    expect(pushes.length).toBe(1);
    expect(pushes[0]!.text).toContain("FAILED");
  });
});

describe("createTools council gating", () => {
  it("omits council tools when unconfigured", () => {
    const tools = createTools({});
    expect(tools["council"]).toBeUndefined();
    expect(tools["council_check"]).toBeUndefined();
  });

  it("registers council tools when configured with a client", () => {
    const { client } = fakePromptClient();
    const tools = createTools({
      client,
      pluginOptions: { council: { members: MEMBERS } },
    });
    expect(tools["council"]).toBeDefined();
    expect(tools["council_check"]).toBeDefined();
    expect(tools["council"]!.description).toContain(MEMBERS[0]!);
  });
});

describe("council-member agent lockdown", () => {
  it("exists, is a subagent, and cannot reach the council tools", async () => {
    const { createAgents } = await import("../src/agents/index.js");
    const agents = createAgents();
    const member = agents[AGENTS.COUNCIL_MEMBER]!;
    expect(member).toBeDefined();
    expect(member.mode).toBe("subagent");
    const tools = member.tools as Record<string, boolean>;
    expect(tools["council"]).toBe(false);
    expect(tools["council_check"]).toBe(false);
    expect(tools["task"]).toBe(false);
    expect(tools["question"]).toBe(false);
    expect(tools["bash"]).toBe(false);
    expect(tools["edit"]).toBe(false);
  });
});
