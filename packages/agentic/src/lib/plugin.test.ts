import { describe, test, expect } from "bun:test";
import { generatePluginManifest } from "./plugin.js";
import { VERSION } from "./version.js";

describe("generatePluginManifest", () => {
  const manifest = generatePluginManifest();

  test("name is glorious", () => {
    expect(manifest.name).toBe("glorious");
  });

  test("version matches VERSION constant", () => {
    expect(manifest.version).toBe(VERSION);
  });

  test("description is non-empty", () => {
    expect(manifest.description.length).toBeGreaterThan(0);
  });

  test("skills path is ./skills", () => {
    expect(manifest.skills).toBe("./skills");
  });

  test("does not include hooks or mcpServers keys", () => {
    const keys = Object.keys(manifest);
    expect(keys).not.toContain("hooks");
    expect(keys).not.toContain("mcpServers");
    expect(keys).not.toContain("lspServers");
  });

  test("JSON.stringify produces valid JSON", () => {
    const json = JSON.stringify(manifest, null, 2);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("glorious");
  });
});
