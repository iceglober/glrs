/**
 * Tests for auto-ship reading title from spec/main.yaml (a8).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-ship-yaml-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSpec(planDir: string, filename: string, content: string): void {
  const specDir = path.join(planDir, "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, filename), content, "utf-8");
}

describe("auto-ship YAML path", () => {
  it("readPlanH1 reads title from spec/main.yaml", async () => {
    const { autoShip } = await import("../src/auto-ship.js");

    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    // Write spec/main.yaml with title
    writeSpec(
      planDir,
      "main.yaml",
      `title: My YAML Feature
goal: Do the thing
phases: []
`,
    );

    // Also write main.md (required for body-file)
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# Old Markdown Title\n\nBody.\n`,
    );

    let capturedTitle = "";
    const mockExecFile = async (
      cmd: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string }> => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "feature-branch\n", stderr: "" };
      }
      if (cmd === "git" && args[0] === "push") {
        return { stdout: "", stderr: "" };
      }
      if (cmd === "gh" && args[0] === "pr") {
        // Capture the title arg
        const titleIdx = args.indexOf("--title");
        if (titleIdx >= 0) capturedTitle = args[titleIdx + 1];
        return { stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    await autoShip({
      planPath: planDir,
      repoRoot: tmpDir,
      _deps: { execFile: mockExecFile as any },
    });

    // Title should come from spec/main.yaml, not main.md H1
    expect(capturedTitle).toBe("My YAML Feature");
  });
});
