import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initState, cleanupState, setPlansDir } from "./state.js";
import { feedbackPath, loadFeedback, appendFeedback, clearFeedback } from "./plan-feedback.js";

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

describe("clearFeedback", () => {
  test("removes feedback file", () => {
    appendFeedback("e1", "1.1", "test");
    expect(loadFeedback("e1")).not.toBeNull();
    clearFeedback("e1");
    expect(loadFeedback("e1")).toBeNull();
  });

  test("no-op when file does not exist", () => {
    expect(() => clearFeedback("e999")).not.toThrow();
  });
});
