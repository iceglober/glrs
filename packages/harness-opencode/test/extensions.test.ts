/**
 * Tests for repo-local prompt extensions (`.glrs/extensions/<name>.md`).
 *
 * Three layers:
 *   1. the shared `readExtension` helper (pure, takes an explicit cwd),
 *   2. command prompts pick it up via `createCommands(cwd)` — regression guard
 *      that lifting the helper out of commands/index.ts didn't change behavior,
 *   3. agent prompts pick it up via `applyConfig` (reads process.cwd()).
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readExtension } from "../src/extensions.js";
import { createCommands } from "../src/commands/index.js";
import { applyConfig } from "../src/config-hook.js";
import { AGENTS } from "@glrs-dev/agent-core";

describe("readExtension", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extensions-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeExt(name: string, body: string): void {
    const dir = path.join(tmpDir, ".glrs", "extensions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), body);
  }

  it("returns '' when no extension file exists", () => {
    expect(readExtension("prime", tmpDir)).toBe("");
  });

  it("returns '' when the file is empty or whitespace-only", () => {
    writeExt("prime", "   \n\t  ");
    expect(readExtension("prime", tmpDir)).toBe("");
  });

  it("wraps present content under a source-naming heading", () => {
    writeExt("prime", "Our CI is GitHub Actions.");
    const ext = readExtension("prime", tmpDir);
    expect(ext).toContain("## Extension (from .glrs/extensions/prime.md)");
    expect(ext).toContain("Our CI is GitHub Actions.");
    // Leading blank lines so it appends cleanly onto a base prompt.
    expect(ext.startsWith("\n\n")).toBe(true);
  });

  it("keys purely by name — works for any command or agent name", () => {
    writeExt("ship", "ship extension");
    writeExt("build", "build extension");
    expect(readExtension("ship", tmpDir)).toContain("ship extension");
    expect(readExtension("build", tmpDir)).toContain("build extension");
    expect(readExtension("nonexistent", tmpDir)).toBe("");
  });

  it("supports a subdir in the key (agents are namespaced under agents/)", () => {
    const dir = path.join(tmpDir, ".glrs", "extensions", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prime.md"), "prime methodology");

    const ext = readExtension("agents/prime", tmpDir);
    expect(ext).toContain("## Extension (from .glrs/extensions/agents/prime.md)");
    expect(ext).toContain("prime methodology");
    // A flat key of the same leaf name does NOT pick up the namespaced file.
    expect(readExtension("prime", tmpDir)).toBe("");
  });
});

describe("command prompts pick up extensions (regression after lift)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extensions-cmd-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends .glrs/extensions/ship.md to the /ship command template", () => {
    const dir = path.join(tmpDir, ".glrs", "extensions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ship.md"), "Custom ship step: wait for review.");

    const ship = createCommands(tmpDir)["ship"]!.template as string;
    expect(ship).toContain("## Extension (from .glrs/extensions/ship.md)");
    expect(ship).toContain("Custom ship step: wait for review.");
  });

  it("leaves the template unchanged when no extension file exists", () => {
    const ship = createCommands(tmpDir)["ship"]!.template as string;
    expect(ship).not.toContain("## Extension (from");
  });
});

describe("agent prompts pick up extensions via applyConfig", () => {
  let tmpDir: string;
  let priorCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extensions-agent-test-"));
    priorCwd = process.cwd();
    process.chdir(tmpDir);
  });
  afterEach(() => {
    process.chdir(priorCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends .glrs/extensions/agents/<agent>.md to that agent's prompt", () => {
    const dir = path.join(tmpDir, ".glrs", "extensions", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${AGENTS.PRIME}.md`),
      "Our CI: `gh pr checks <pr> --watch --fail-fast`.",
    );

    const config: any = {};
    applyConfig(config);

    const primePrompt = config.agent[AGENTS.PRIME].prompt as string;
    expect(primePrompt).toContain(
      `## Extension (from .glrs/extensions/agents/${AGENTS.PRIME}.md)`,
    );
    expect(primePrompt).toContain("--watch --fail-fast");
    // An agent with no extension file is left untouched.
    expect(config.agent[AGENTS.BUILD].prompt).not.toContain("## Extension (from");
  });

  it("a flat (command-style) key does NOT leak into the agent prompt", () => {
    // `.glrs/extensions/prime.md` (flat) is a command-namespace path; it must
    // not reach the prime AGENT, which only reads agents/prime.md.
    const dir = path.join(tmpDir, ".glrs", "extensions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${AGENTS.PRIME}.md`), "flat prime file");

    const config: any = {};
    applyConfig(config);

    expect(config.agent[AGENTS.PRIME].prompt).not.toContain("flat prime file");
    expect(config.agent[AGENTS.PRIME].prompt).not.toContain("## Extension (from");
  });

  it("is a no-op for every agent when no extensions dir exists", () => {
    const config: any = {};
    applyConfig(config);
    for (const cfg of Object.values(config.agent) as any[]) {
      if (typeof cfg?.prompt === "string") {
        expect(cfg.prompt).not.toContain("## Extension (from");
      }
    }
  });
});
