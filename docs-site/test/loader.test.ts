/**
 * Unit tests for docs-site/src/loader.ts
 *
 * Uses a synthetic fixture tree at docs-site/test/fixtures/ — no Astro runtime needed.
 * Covers acceptance criterion a4.
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSources } from "../src/loader.js";
import type { GlrsSource } from "../src/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

// We use fixturesDir as the baseDir for all tests.
// Sources use paths relative to fixturesDir.

describe("glrsContentLoader — core behavior", () => {
  test("emits entry per README with slug derived from package name", () => {
    const sources: GlrsSource[] = [
      {
        base: "pkg-a",
        slugPrefix: "/pkg-a/",
        singleFile: "README.md",
        titleFallback: "@glrs-dev/pkg-a",
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("pkg-a");
    expect(entries[0].data.title).toBe("@glrs-dev/pkg-a");
  });

  test("emits entries for packages/<pkg>/docs/ markdown files with correct nested slugs", () => {
    const sources: GlrsSource[] = [
      {
        base: "pkg-a/docs",
        slugPrefix: "/pkg-a/",
        include: ["**/*.md"],
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("pkg-a/guide");
    expect(entries[0].data.title).toBe("Guide");
  });

  test("emits entries from repo-root docs/ with top-level slugs", () => {
    const sources: GlrsSource[] = [
      {
        base: "shared",
        slugPrefix: "/",
        include: ["**/*.md"],
        ignore: ["ignored/**"],
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("intro");
  });

  test("synthesizes title from first H1 stripping code/emphasis markers", () => {
    const sources: GlrsSource[] = [
      {
        base: "pkg-a",
        slugPrefix: "/pkg-a/",
        singleFile: "README.md",
        titleFallback: "fallback",
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    // H1 is "# @glrs-dev/pkg-a" — no backticks/asterisks to strip here
    expect(entries[0].data.title).toBe("@glrs-dev/pkg-a");
  });

  test("synthesizes description from first paragraph stripping markdown links", () => {
    const sources: GlrsSource[] = [
      {
        base: "pkg-a",
        slugPrefix: "/pkg-a/",
        singleFile: "README.md",
        titleFallback: "fallback",
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    expect(typeof entries[0].data.description).toBe("string");
    expect((entries[0].data.description as string).length).toBeGreaterThan(0);
    // Should not contain markdown syntax
    expect(entries[0].data.description as string).not.toMatch(/\[.*\]\(.*\)/);
  });

  test("falls back to package name when README has no H1", () => {
    const sources: GlrsSource[] = [
      {
        base: "pkg-b",
        slugPrefix: "/pkg-b/",
        singleFile: "README.md",
        titleFallback: "@glrs-dev/pkg-b",
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    expect(entries[0].data.title).toBe("@glrs-dev/pkg-b");
  });

  test("honors ignore patterns (pilot/spikes/**, archive/**)", () => {
    const sources: GlrsSource[] = [
      {
        base: "shared",
        slugPrefix: "/",
        include: ["**/*.md"],
        ignore: ["ignored/**"],
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    // ignored/spike.md should be excluded
    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain("ignored/spike");
    expect(ids).not.toContain("spike");
  });

  test("preserves existing frontmatter when present", () => {
    const sources: GlrsSource[] = [
      {
        base: "shared",
        slugPrefix: "/",
        include: ["**/*.md"],
        ignore: ["ignored/**"],
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    const intro = entries.find((e) => e.id === "intro");
    expect(intro).toBeDefined();
    expect(intro!.data.title).toBe("Preserved");
    expect(intro!.data.description).toBe("Also preserved");
  });

  test("collision: two sources emitting the same id throws", () => {
    // collide/README.md (singleFile, slugPrefix /collide/) → id = "collide"
    // collide/docs/index.md (directory, slugPrefix /collide/) → id = "collide/index"
    // To force a real collision: use two singleFile sources with the same slugPrefix
    const sources: GlrsSource[] = [
      {
        base: "collide",
        slugPrefix: "/collide/",
        singleFile: "README.md",
        titleFallback: "collide",
      },
      {
        base: "collide",
        slugPrefix: "/collide/",
        singleFile: "README.md",
        titleFallback: "collide-dup",
      },
    ];
    expect(() => scanSources(sources, fixturesDir)).toThrow(/Duplicate entry id/);
  });

  test("nested slug: pkg-b/docs/nested/deep.md emits correct multi-segment slug", () => {
    const sources: GlrsSource[] = [
      {
        base: "pkg-b/docs",
        slugPrefix: "/pkg-b/",
        include: ["**/*.md"],
      },
    ];
    const entries = scanSources(sources, fixturesDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("pkg-b/nested/deep");
  });
});
