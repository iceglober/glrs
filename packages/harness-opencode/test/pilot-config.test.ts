// pilot-config.test.ts — tests for .glrs/pilot.json loader.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadPilotConfig, PILOT_JSON_FILENAME } from "../src/pilot/worker/pilot-config.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-config-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(cwd: string, obj: unknown): void {
  const dir = path.join(cwd, ".glrs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pilot.json"), JSON.stringify(obj));
}

describe("loadPilotConfig", () => {
  test("returns empty config when file is missing", async () => {
    const cfg = await loadPilotConfig(tmp);
    expect(cfg.baseline).toEqual([]);
    expect(cfg.after_each).toEqual([]);
  });

  test("parses a valid config with both fields", async () => {
    writeConfig(tmp, {
      baseline: ["pnpm typecheck", "pnpm lint"],
      after_each: ["pnpm typecheck"],
    });
    const cfg = await loadPilotConfig(tmp);
    expect(cfg.baseline).toEqual(["pnpm typecheck", "pnpm lint"]);
    expect(cfg.after_each).toEqual(["pnpm typecheck"]);
  });

  test("missing fields default to empty arrays", async () => {
    writeConfig(tmp, { baseline: ["pnpm typecheck"] });
    const cfg = await loadPilotConfig(tmp);
    expect(cfg.baseline).toEqual(["pnpm typecheck"]);
    expect(cfg.after_each).toEqual([]);
  });

  test("empty object is valid", async () => {
    writeConfig(tmp, {});
    const cfg = await loadPilotConfig(tmp);
    expect(cfg.baseline).toEqual([]);
    expect(cfg.after_each).toEqual([]);
  });

  test("throws on invalid JSON", async () => {
    const dir = path.join(tmp, ".glrs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pilot.json"), "not json{");
    await expect(loadPilotConfig(tmp)).rejects.toThrow(/invalid JSON/);
  });

  test("throws on non-object root", async () => {
    writeConfig(tmp, [1, 2, 3]);
    await expect(loadPilotConfig(tmp)).rejects.toThrow(/expected a JSON object/);
  });

  test("throws on non-string array entries", async () => {
    writeConfig(tmp, { baseline: [42] });
    await expect(loadPilotConfig(tmp)).rejects.toThrow(/non-empty string/);
  });

  test("throws on empty string in array", async () => {
    writeConfig(tmp, { after_each: ["pnpm typecheck", ""] });
    await expect(loadPilotConfig(tmp)).rejects.toThrow(/non-empty string/);
  });

  test("PILOT_JSON_FILENAME is .glrs/pilot.json", () => {
    expect(PILOT_JSON_FILENAME).toBe(".glrs/pilot.json");
  });
});
