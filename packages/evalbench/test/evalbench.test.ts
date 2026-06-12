import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateManifest, validateRubric, type Rubric } from "../src/manifest.js";
import { callTool, handleMessage, listIssues } from "../src/mock-linear.js";
import { buildEvaluatorPrompt, extractJson, composite, median } from "../src/score.js";
import { renderTranscript, runChecks } from "../src/run.js";

const FIXTURES = path.resolve(import.meta.dir, "..", "fixtures");

describe("fixtures are well-formed", () => {
  const names = fs
    .readdirSync(FIXTURES)
    .filter((f) => fs.existsSync(path.join(FIXTURES, f, "manifest.json")));

  it("at least 4 fixtures exist", () => {
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of names) {
    it(`${name}: manifest, rubric, task, ground-truth all valid`, () => {
      const m = JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "manifest.json"), "utf8"));
      validateManifest(m);
      expect(m.name).toBe(name);
      validateRubric(JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "rubric.json"), "utf8")));
      expect(fs.readFileSync(path.join(FIXTURES, name, "task.md"), "utf8").length).toBeGreaterThan(50);
      expect(fs.readFileSync(path.join(FIXTURES, name, "ground-truth.md"), "utf8").length).toBeGreaterThan(100);
      if (m.mockLinear) {
        expect(fs.existsSync(path.join(FIXTURES, name, "linear", "search-index.json"))).toBe(true);
      }
    });
  }
});

describe("manifest validation rejects junk", () => {
  it("rejects bad shapes", () => {
    expect(() => validateManifest({})).toThrow(/name/);
    expect(() => validateManifest({ name: "X Y", summary: "s" })).toThrow(/kebab/);
    expect(() =>
      validateRubric({ scaleMax: 10, criteria: [{ key: "a", weight: 0.5, definition: "d" }] }),
    ).toThrow(/sum to 1/);
  });
});

describe("mock-linear", () => {
  const dir = path.join(FIXTURES, "triage-gen2849", "linear");
  const state = fs.mkdtempSync("/tmp/mock-linear-test-");

  it("serves frozen issues and comments", () => {
    const out = callTool(dir, state, "get_issue", { id: "GEN-2849" });
    expect(out.isError).toBeUndefined();
    const issue = JSON.parse(out.text);
    expect(issue.id).toBe("GEN-2849");
    expect(issue.title).toContain("KESB-145");
    const comments = JSON.parse(callTool(dir, state, "list_comments", { issueId: "GEN-2849" }).text);
    expect(comments.comments.length).toBeGreaterThanOrEqual(1);
  });

  it("search finds siblings by source reference", () => {
    const res = listIssues(dir, "KESB-145") as { issues: { id: string }[] };
    const ids = res.issues.map((i) => i.id);
    expect(ids).toContain("GEN-2849");
    expect(ids).toContain("GEN-2620");
  });

  it("records mutations instead of writing", () => {
    const out = callTool(dir, state, "save_comment", { issueId: "GEN-2849", body: "hello" });
    expect(JSON.parse(out.text).recorded).toBe(true);
    const log = fs.readFileSync(path.join(state, "mutations.jsonl"), "utf8");
    expect(log).toContain("save_comment");
    expect(log).toContain("hello");
  });

  it("speaks enough MCP to initialize and list tools", () => {
    const init = handleMessage({ id: 1, method: "initialize", params: {} });
    expect(init).toContain("mock-linear");
    const tools = handleMessage({ id: 2, method: "tools/list" });
    expect(tools).toContain("get_issue");
    expect(tools).toContain("save_comment");
    expect(handleMessage({ method: "notifications/initialized" })).toBeNull();
  });
});

describe("scorer helpers", () => {
  const rubric: Rubric = {
    scaleMax: 10,
    criteria: [
      { key: "a", weight: 0.6, definition: "A" },
      { key: "b", weight: 0.4, definition: "B" },
    ],
  };

  it("extractJson tolerates fences and prose", () => {
    expect(extractJson('Sure! ```json\n{"a": 8, "b": 6}\n``` done')).toEqual({ a: 8, b: 6 });
    expect(extractJson("no json here")).toBeNull();
  });

  it("composite recomputes from weights and rejects out-of-range", () => {
    expect(composite(rubric, { a: 8, b: 6 })).toBe(7.2);
    expect(composite(rubric, { a: 11, b: 6 })).toBeNull();
    expect(composite(rubric, { a: 8 })).toBeNull();
  });

  it("median is robust to one outlier", () => {
    expect(median([7.2, 7.4, 2.0])).toBe(7.2);
    expect(median([7.0, 8.0])).toBe(7.5);
  });

  it("evaluator prompt carries rubric, ground truth, and bounds the transcript", () => {
    const p = buildEvaluatorPrompt(rubric, "GROUND", "x".repeat(200_000));
    expect(p).toContain("GROUND");
    expect(p).toContain('"a": n');
    expect(p.length).toBeLessThan(120_000);
    expect(p).toContain("[middle truncated]");
  });
});

describe("runner helpers", () => {
  it("renderTranscript counts guards, nudges, duplicates and finds the final answer", () => {
    const { callSigs, guardFires, deadTurnNudges, finalText } = renderTranscript(
      [
        {
          info: { role: "assistant", time: { created: 1, completed: 2 } },
          parts: [
            { type: "tool", tool: "grep", state: { input: { q: "x" }, output: "hit\n\n--- LOOP WARNING: STOP ---", status: "completed" } },
            { type: "tool", tool: "grep", state: { input: { q: "x" }, output: "hit", status: "completed" } },
          ],
        },
        { info: { role: "user" }, parts: [{ type: "text", text: "Your last turn ended after internal reasoning only — nudge" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "final answer" }] },
      ],
      "# t",
    );
    expect(callSigs.length).toBe(2);
    expect(callSigs.length - new Set(callSigs).size).toBe(1);
    expect(guardFires).toBe(1);
    expect(deadTurnNudges).toBe(1);
    expect(finalText).toBe("final answer");
  });

  it("runChecks: regex + answer-length gates", () => {
    const checks = runChecks(
      {
        name: "x",
        summary: "s",
        shape: "q",
        repo: { source: "glrs", ref: "HEAD" },
        budgetMin: 1,
        mockLinear: false,
        checks: { finalAnswerMustMatch: ["duplicate", "GEN-9999"] },
      },
      "This is a Duplicate of prior work. ".repeat(10),
      "/tmp",
    );
    expect(checks.find((c) => c.name.includes("duplicate"))!.pass).toBe(true);
    expect(checks.find((c) => c.name.includes("GEN-9999"))!.pass).toBe(false);
    expect(checks.find((c) => c.name === "final-answer-present")!.pass).toBe(true);
  });
});
