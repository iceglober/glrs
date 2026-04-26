import { describe, expect, it } from "bun:test";
import { resolveMatches } from "./path.js";
import type { RegistryEntry } from "../lib/registry.js";

function entry(repo: string, branch: string): RegistryEntry {
  return {
    repo,
    repoPath: `/tmp/${repo}`,
    wtPath: `/tmp/worktrees/${repo}/${branch}`,
    branch,
    createdAt: "2026-04-19T00:00:00Z",
  };
}

describe("resolveMatches", () => {
  const entries = [
    entry("glorious", "feat-a"),
    entry("glorious", "feat-b"),
    entry("kn-eng", "feat-a"), // same branch name, different repo
    entry("other", "unique"),
  ];

  it("matches by bare branch name", () => {
    const got = resolveMatches(entries, "feat-b");
    expect(got.map((e) => e.wtPath)).toEqual([
      "/tmp/worktrees/glorious/feat-b",
    ]);
  });

  it("returns all matches for an ambiguous branch name", () => {
    const got = resolveMatches(entries, "feat-a");
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.repo).sort()).toEqual(["glorious", "kn-eng"]);
  });

  it("disambiguates with <repo>/<name>", () => {
    const got = resolveMatches(entries, "kn-eng/feat-a");
    expect(got).toHaveLength(1);
    expect(got[0].repo).toBe("kn-eng");
  });

  it("returns empty for unknown query", () => {
    expect(resolveMatches(entries, "nope")).toEqual([]);
    expect(resolveMatches(entries, "glorious/nope")).toEqual([]);
  });

  it("treats an unknown repo prefix as no match", () => {
    expect(resolveMatches(entries, "missing-repo/feat-a")).toEqual([]);
  });
});
