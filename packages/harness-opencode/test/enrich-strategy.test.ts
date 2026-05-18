import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadStrategy, applyStrategy, extractFieldNames } from "../src/autopilot/enrich-strategy.js";

describe("enrich-strategy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "enrich-strategy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads `default` from the bundled built-in when no project file exists", () => {
    const template = loadStrategy(tmpDir, "default");
    expect(typeof template).toBe("string");
    expect(template.length).toBeGreaterThan(0);
    expect(template).toContain("{{file}}");
    expect(template).toContain("{{content}}");
  });

  it("prefers .glrs/plan-enrich-strategies/<name>.md over the built-in", () => {
    const strategyDir = path.join(tmpDir, ".glrs", "plan-enrich-strategies");
    fs.mkdirSync(strategyDir, { recursive: true });
    const customContent = "Custom {{file}} strategy with {{content}}";
    fs.writeFileSync(path.join(strategyDir, "custom.md"), customContent);

    const template = loadStrategy(tmpDir, "custom");
    expect(template).toBe(customContent);
  });

  it("applyStrategy substitutes {{file}} and {{content}} (multiple occurrences)", () => {
    const template = "File: {{file}}\nContent: {{content}}\nFile again: {{file}}";
    const file = "test.md";
    const content = "test content";
    const result = applyStrategy(template, file, content);

    expect(result).toBe("File: test.md\nContent: test content\nFile again: test.md");
  });

  it("unknown name throws with searched paths in the message", () => {
    expect(() => loadStrategy(tmpDir, "nonexistent")).toThrow();
    const err = (() => {
      try {
        loadStrategy(tmpDir, "nonexistent");
      } catch (e) {
        return e;
      }
    })();
    const message = (err as Error).message;
    expect(message).toContain("nonexistent");
    expect(message).toContain(".glrs/plan-enrich-strategies");
    expect(message).toContain("strategies");
  });
});

describe("extractFieldNames", () => {
  it("extracts field names from dash-prefixed strategy", () => {
    const strategy = `
Some intro text.

For each item:
   - **mirror**: Find the most similar existing file
   - **context**: Relevant function/section
   - **conventions**: Import style, test framework
`;
    const fields = extractFieldNames(strategy);
    expect(fields).toEqual(["mirror", "context", "conventions"]);
  });

  it("extracts field names from numbered list strategy", () => {
    const strategy = `
For each item:
1. **title**: The item title
2. **description**: What to do
3. **impact**: Expected outcome
`;
    const fields = extractFieldNames(strategy);
    expect(fields).toEqual(["title", "description", "impact"]);
  });

  it("handles mixed indentation levels", () => {
    const strategy = `
   - **mirror**: Similar file
  - **context**: Code snippet
    - **conventions**: Patterns
`;
    const fields = extractFieldNames(strategy);
    expect(fields).toEqual(["mirror", "context", "conventions"]);
  });

  it("returns defaults when no fields found", () => {
    const strategy = "Some strategy text with no field markers";
    const fields = extractFieldNames(strategy);
    expect(fields).toEqual(["mirror", "context", "conventions"]);
  });

  it("extracts multiple occurrences in order", () => {
    const strategy = `
1. **alpha**: First field
2. **bravo**: Second field
3. **charlie**: Third field
4. **delta**: Fourth field
`;
    const fields = extractFieldNames(strategy);
    expect(fields).toEqual(["alpha", "bravo", "charlie", "delta"]);
  });
});
