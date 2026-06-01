/**
 * Tests for dev-preset loading/merging/resolution. The bundled presets ship in
 * src/dev-presets.json; these tests also exercise the external-override layer
 * via a temp file pointed at by GLRS_DEV_PRESETS_FILE.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDevPresets,
  resolveDevPreset,
  unknownAgents,
  agentOverridesJson,
  type DevPreset,
} from "../src/lib/dev-presets.js";

const tmpFiles: string[] = [];
function writeExternal(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "glrs-presets-"));
  const file = join(dir, "dev-presets.json");
  writeFileSync(file, JSON.stringify(obj), "utf8");
  tmpFiles.push(dir);
  return file;
}

afterEach(() => {
  delete process.env["GLRS_DEV_PRESETS_FILE"];
  while (tmpFiles.length) rmSync(tmpFiles.pop()!, { recursive: true, force: true });
});

describe("loadDevPresets", () => {
  it("returns the bundled presets when no external file exists", () => {
    const presets = loadDevPresets("/nonexistent/dev-presets.json");
    const ids = presets.map((p) => p.id);
    expect(ids).toContain("baseline");
    expect(ids).toContain("1");
    expect(ids).toContain("2");
  });

  it("external presets override bundled ones by id and add new ones", () => {
    const file = writeExternal({
      presets: [
        { id: "1", label: "Overridden", agents: { prime: { model: "x/y" } } },
        { id: "99", label: "New", agents: {} },
      ],
    });
    const presets = loadDevPresets(file);

    const one = presets.find((p) => p.id === "1")!;
    expect(one.label).toBe("Overridden");
    expect(one.agents.prime?.model).toBe("x/y");
    expect(presets.find((p) => p.id === "99")?.label).toBe("New");
    // Bundled "baseline" is still present (external only adds/overrides).
    expect(presets.find((p) => p.id === "baseline")).toBeDefined();
  });

  it("throws a clear error on malformed external JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "glrs-presets-"));
    const file = join(dir, "dev-presets.json");
    writeFileSync(file, "{ not json", "utf8");
    tmpFiles.push(dir);
    expect(() => loadDevPresets(file)).toThrow(/Invalid JSON/);
  });

  it("throws when external file lacks a presets array", () => {
    const file = writeExternal({ nope: true });
    expect(() => loadDevPresets(file)).toThrow(/presets" array/);
  });
});

describe("resolveDevPreset", () => {
  it("finds by id and returns undefined for unknown ids", () => {
    const presets = loadDevPresets("/nonexistent");
    expect(resolveDevPreset("baseline", presets)?.id).toBe("baseline");
    expect(resolveDevPreset("does-not-exist", presets)).toBeUndefined();
  });
});

describe("unknownAgents", () => {
  it("flags agent names that aren't real agents", () => {
    const preset: DevPreset = {
      id: "t",
      label: "t",
      agents: { prime: { model: "a/b" }, not_an_agent: { model: "a/b" } },
    };
    expect(unknownAgents(preset)).toEqual(["not_an_agent"]);
  });

  it("returns empty for an all-known preset", () => {
    const preset: DevPreset = { id: "t", label: "t", agents: { prime: {} } };
    expect(unknownAgents(preset)).toEqual([]);
  });
});

describe("agentOverridesJson", () => {
  it("serializes the agents map to the GLRS_AGENT_OVERRIDES shape", () => {
    const preset: DevPreset = {
      id: "t",
      label: "t",
      agents: { build: { model: "a/b", prompt: ".glrs/experiments/build.md" } },
    };
    expect(JSON.parse(agentOverridesJson(preset))).toEqual({
      build: { model: "a/b", prompt: ".glrs/experiments/build.md" },
    });
  });

  it("serializes baseline (empty agents) to {}", () => {
    const baseline = resolveDevPreset("baseline", loadDevPresets("/nonexistent"))!;
    expect(agentOverridesJson(baseline)).toBe("{}");
  });
});
