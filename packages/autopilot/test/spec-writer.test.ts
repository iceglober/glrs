/**
 * Tests for the YAML spec writer (spec-writer.ts).
 *
 * Covers:
 *   - Marking items checked in phase YAML
 *   - Marking phases completed in main.yaml
 *   - Writing enrichment fields to items
 *   - Preserving existing fields when updating
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as yamlParse } from "yaml";
import {
  markItemChecked,
  markPhaseCompleted,
  writeEnrichmentFields,
} from "../src/spec-writer.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-writer-test-"));
  fs.mkdirSync(path.join(tmpDir, "spec"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(filename: string, content: string): void {
  fs.writeFileSync(path.join(tmpDir, "spec", filename), content, "utf-8");
}

function readYaml(filename: string): unknown {
  const content = fs.readFileSync(
    path.join(tmpDir, "spec", filename),
    "utf-8",
  );
  return yamlParse(content);
}

// ---------------------------------------------------------------------------
// markItemChecked
// ---------------------------------------------------------------------------

describe("markItemChecked", () => {
  it("marks item checked in phase YAML", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: First item
    checked: false
  - id: a2
    intent: Second item
    checked: false
`,
    );

    markItemChecked(tmpDir, "wave_0.yaml", "a1");

    const result = readYaml("wave_0.yaml") as {
      items: Array<{ id: string; checked: boolean }>;
    };
    expect(result.items[0].checked).toBe(true);
    expect(result.items[1].checked).toBe(false);
  });

  it("is idempotent — marking already-checked item stays checked", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Already done
    checked: true
`,
    );

    markItemChecked(tmpDir, "wave_0.yaml", "a1");

    const result = readYaml("wave_0.yaml") as {
      items: Array<{ id: string; checked: boolean }>;
    };
    expect(result.items[0].checked).toBe(true);
  });

  it("does nothing when item id not found", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item
    checked: false
`,
    );

    // Should not throw
    expect(() => markItemChecked(tmpDir, "wave_0.yaml", "nonexistent")).not.toThrow();

    const result = readYaml("wave_0.yaml") as {
      items: Array<{ id: string; checked: boolean }>;
    };
    expect(result.items[0].checked).toBe(false);
  });

  it("preserves existing fields when updating", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item with extra fields
    checked: false
    verify: bun test
    tests:
      - test/foo.test.ts::"passes"
    mirror: src/existing.ts
`,
    );

    markItemChecked(tmpDir, "wave_0.yaml", "a1");

    const result = readYaml("wave_0.yaml") as {
      items: Array<{
        id: string;
        checked: boolean;
        verify: string;
        tests: string[];
        mirror: string;
      }>;
    };
    expect(result.items[0].checked).toBe(true);
    expect(result.items[0].verify).toBe("bun test");
    expect(result.items[0].tests).toEqual(['test/foo.test.ts::"passes"']);
    expect(result.items[0].mirror).toBe("src/existing.ts");
  });
});

// ---------------------------------------------------------------------------
// markPhaseCompleted
// ---------------------------------------------------------------------------

describe("markPhaseCompleted", () => {
  it("marks phase completed in main.yaml", () => {
    writeYaml(
      "main.yaml",
      `title: My Plan
phases:
  - file: wave_0.yaml
    completed: false
  - file: wave_1.yaml
    completed: false
`,
    );

    markPhaseCompleted(tmpDir, "wave_0.yaml");

    const result = readYaml("main.yaml") as {
      phases: Array<{ file: string; completed: boolean }>;
    };
    expect(result.phases[0].completed).toBe(true);
    expect(result.phases[1].completed).toBe(false);
  });

  it("is idempotent — marking already-completed phase stays completed", () => {
    writeYaml(
      "main.yaml",
      `title: My Plan
phases:
  - file: wave_0.yaml
    completed: true
`,
    );

    markPhaseCompleted(tmpDir, "wave_0.yaml");

    const result = readYaml("main.yaml") as {
      phases: Array<{ file: string; completed: boolean }>;
    };
    expect(result.phases[0].completed).toBe(true);
  });

  it("does nothing when phase file not found in main.yaml", () => {
    writeYaml(
      "main.yaml",
      `title: My Plan
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    expect(() =>
      markPhaseCompleted(tmpDir, "nonexistent.yaml"),
    ).not.toThrow();

    const result = readYaml("main.yaml") as {
      phases: Array<{ file: string; completed: boolean }>;
    };
    expect(result.phases[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeEnrichmentFields
// ---------------------------------------------------------------------------

describe("writeEnrichmentFields", () => {
  it("writes enrichment fields to item", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item to enrich
    checked: false
`,
    );

    writeEnrichmentFields(tmpDir, "wave_0.yaml", "a1", {
      mirror: "src/existing/similar.ts",
      context: "function foo() { return 42; }",
      conventions: "bun:test, named exports",
    });

    const result = readYaml("wave_0.yaml") as {
      items: Array<{
        id: string;
        mirror: string;
        context: string;
        conventions: string;
      }>;
    };
    expect(result.items[0].mirror).toBe("src/existing/similar.ts");
    expect(result.items[0].context).toBe("function foo() { return 42; }");
    expect(result.items[0].conventions).toBe("bun:test, named exports");
  });

  it("preserves existing fields when updating", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item with existing data
    checked: false
    verify: bun test
    mirror: src/old.ts
`,
    );

    writeEnrichmentFields(tmpDir, "wave_0.yaml", "a1", {
      mirror: "src/new.ts",
      context: "new context",
    });

    const result = readYaml("wave_0.yaml") as {
      items: Array<{
        id: string;
        intent: string;
        checked: boolean;
        verify: string;
        mirror: string;
        context: string;
      }>;
    };
    expect(result.items[0].intent).toBe("Item with existing data");
    expect(result.items[0].checked).toBe(false);
    expect(result.items[0].verify).toBe("bun test");
    expect(result.items[0].mirror).toBe("src/new.ts");
    expect(result.items[0].context).toBe("new context");
  });

  it("does nothing when item id not found", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item
    checked: false
`,
    );

    expect(() =>
      writeEnrichmentFields(tmpDir, "wave_0.yaml", "nonexistent", {
        mirror: "src/foo.ts",
      }),
    ).not.toThrow();

    const result = readYaml("wave_0.yaml") as {
      items: Array<{ id: string; mirror?: string }>;
    };
    expect(result.items[0].mirror).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Atomic write tests (a4)
// ---------------------------------------------------------------------------

describe("atomic writes", () => {
  it("markItemChecked uses atomic write (tmp + rename)", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item
    checked: false
`,
    );

    const renames: Array<{ from: string; to: string }> = [];
    const origRename = fs.renameSync.bind(fs);
    const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames.push({ from: String(from), to: String(to) });
      origRename(from, to);
    });

    try {
      markItemChecked(tmpDir, "wave_0.yaml", "a1");
    } finally {
      spy.mockRestore();
    }

    // renameSync should have been called once
    expect(renames).toHaveLength(1);
    // The rename target should be the actual spec file
    expect(renames[0].to).toBe(path.join(tmpDir, "spec", "wave_0.yaml"));
    // The rename source should be a tmp file (different from target)
    expect(renames[0].from).not.toBe(renames[0].to);
    // The final file should have the item checked
    const result = readYaml("wave_0.yaml") as {
      items: Array<{ id: string; checked: boolean }>;
    };
    expect(result.items[0].checked).toBe(true);
  });

  it("markPhaseCompleted uses atomic write (tmp + rename)", () => {
    writeYaml(
      "main.yaml",
      `title: My Plan
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    const renames: Array<{ from: string; to: string }> = [];
    const origRename = fs.renameSync.bind(fs);
    const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames.push({ from: String(from), to: String(to) });
      origRename(from, to);
    });

    try {
      markPhaseCompleted(tmpDir, "wave_0.yaml");
    } finally {
      spy.mockRestore();
    }

    expect(renames).toHaveLength(1);
    expect(renames[0].to).toBe(path.join(tmpDir, "spec", "main.yaml"));
    expect(renames[0].from).not.toBe(renames[0].to);
    const result = readYaml("main.yaml") as {
      phases: Array<{ file: string; completed: boolean }>;
    };
    expect(result.phases[0].completed).toBe(true);
  });

  it("writeEnrichmentFields uses atomic write (tmp + rename)", () => {
    writeYaml(
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item to enrich
    checked: false
`,
    );

    const renames: Array<{ from: string; to: string }> = [];
    const origRename = fs.renameSync.bind(fs);
    const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames.push({ from: String(from), to: String(to) });
      origRename(from, to);
    });

    try {
      writeEnrichmentFields(tmpDir, "wave_0.yaml", "a1", {
        mirror: "src/foo.ts",
        context: "ctx",
        conventions: "bun:test",
      });
    } finally {
      spy.mockRestore();
    }

    expect(renames).toHaveLength(1);
    expect(renames[0].to).toBe(path.join(tmpDir, "spec", "wave_0.yaml"));
    expect(renames[0].from).not.toBe(renames[0].to);
    const result = readYaml("wave_0.yaml") as {
      items: Array<{ id: string; mirror: string }>;
    };
    expect(result.items[0].mirror).toBe("src/foo.ts");
  });
});
