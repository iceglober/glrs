import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initState, cleanupState, setPlansDir } from "./state.js";
import { feedbackPath, loadFeedback, appendFeedback, resolveFeedback, listResolvedFeedback } from "./plan-feedback.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-feedback-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DIR, "state.db");
const TEST_PLANS_DIR = path.join(TEST_DIR, "plans");

beforeEach(async () => {
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  await initState(TEST_DB_PATH);
  setPlansDir(TEST_PLANS_DIR);
});

afterEach(() => {
  setPlansDir(null);
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe("feedbackPath", () => {
  test("returns correct path under plansDir", () => {
    const p = feedbackPath("e1");
    expect(p).toBe(path.join(TEST_PLANS_DIR, "e1", "feedback.md"));
  });
});

describe("loadFeedback", () => {
  test("returns null when no file exists", () => {
    expect(loadFeedback("e999")).toBeNull();
  });
});

describe("appendFeedback", () => {
  test("creates file with header on first call", () => {
    appendFeedback("e1", "1.1", "needs work");
    const content = loadFeedback("e1");
    expect(content).toBe("# Plan Feedback\n\n## Step 1.1\nneeds work\n\n");
  });

  test("appends to existing file", () => {
    appendFeedback("e1", "1.1", "fix this");
    appendFeedback("e1", "2.1", "looks good");
    const content = loadFeedback("e1")!;
    expect(content).toContain("## Step 1.1\nfix this");
    expect(content).toContain("## Step 2.1\nlooks good");
  });

  test("creates parent directories for new entity", () => {
    appendFeedback("e99", "1.1", "test");
    const p = feedbackPath("e99");
    expect(fs.existsSync(p)).toBe(true);
  });
});

describe("resolveFeedback", () => {
  test("archives feedback file as resolved with timestamp and random suffix", () => {
    appendFeedback("e1", "1.1", "test");
    expect(loadFeedback("e1")).not.toBeNull();
    resolveFeedback("e1");
    expect(loadFeedback("e1")).toBeNull();
    const dir = path.join(TEST_PLANS_DIR, "e1");
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("feedback-resolved-") && f.endsWith(".md"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^feedback-resolved-.*-[a-z0-9]+\.md$/);
  });

  test("two rapid resolves produce distinct filenames", () => {
    appendFeedback("e1", "1.1", "first");
    resolveFeedback("e1");
    appendFeedback("e1", "2.1", "second");
    resolveFeedback("e1");
    const dir = path.join(TEST_PLANS_DIR, "e1");
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("feedback-resolved-") && f.endsWith(".md"));
    expect(files).toHaveLength(2);
    expect(files[0]).not.toBe(files[1]);
  });

  test("no-op when feedback file does not exist", () => {
    expect(() => resolveFeedback("e999")).not.toThrow();
  });

  test("archived file retains original content", () => {
    appendFeedback("e1", "1.1", "needs work");
    resolveFeedback("e1");
    const dir = path.join(TEST_PLANS_DIR, "e1");
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("feedback-resolved-"));
    const content = fs.readFileSync(path.join(dir, files[0]), "utf-8");
    expect(content).toContain("## Step 1.1\nneeds work");
  });
});

describe("listResolvedFeedback", () => {
  test("returns empty array for nonexistent entity", () => {
    expect(listResolvedFeedback("e999")).toEqual([]);
  });

  test("returns sorted archived files after multiple resolve cycles", async () => {
    appendFeedback("e1", "1.1", "first");
    resolveFeedback("e1");
    await new Promise((r) => setTimeout(r, 20));
    appendFeedback("e1", "2.1", "second");
    resolveFeedback("e1");
    const files = listResolvedFeedback("e1");
    expect(files).toHaveLength(2);
    expect(files[0] < files[1]).toBe(true);
    for (const f of files) {
      expect(f).toMatch(/^feedback-resolved-.*\.md$/);
    }
  });

  test("ignores non-matching files", () => {
    const dir = path.join(TEST_PLANS_DIR, "e1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.md"), "irrelevant");
    fs.writeFileSync(path.join(dir, "v1.md"), "plan version");
    expect(listResolvedFeedback("e1")).toEqual([]);
  });
});
