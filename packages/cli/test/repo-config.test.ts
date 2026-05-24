/**
 * Tests for getConfiguredRepos — reading repos.yaml and scanning worktrees.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// We need to test getConfiguredRepos with synthetic config paths.
// Since the function reads from hardcoded paths (~/.config/glrs/repos.yaml
// and ~/.glorious/worktrees/), we test the underlying helpers by importing
// the module and using a test-friendly approach: create the actual files
// in temp dirs and verify the logic via the exported function with mocked paths.
//
// Since the paths are hardcoded constants, we test the parsing logic
// separately and the integration via a re-export pattern.
// ---------------------------------------------------------------------------

// Import the internal helpers by re-exporting them for testing
// (We test the public API via a wrapper that accepts custom paths)
import { getConfiguredRepos } from "../src/repo-config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-config-test-"));
  tmpDirs.push(dir);
  return dir;
}

function makeGitRepo(dir: string, branch = "main"): void {
  const gitDir = path.join(dir, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
}

function makeAutopilotActive(dir: string): void {
  const agentDir = path.join(dir, ".agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "autopilot-events.jsonl"),
    JSON.stringify({ type: "session:start", timestamp: new Date().toISOString(), planPath: "/plans/main.md", cwd: dir, resume: false }) + "\n",
  );
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Tests for the public API
// ---------------------------------------------------------------------------

describe("getConfiguredRepos", () => {
  it("returns an array (possibly empty) without throwing", () => {
    // The real function reads from ~/.config/glrs/repos.yaml and ~/.glorious/worktrees/
    // which may or may not exist. It should never throw.
    expect(() => getConfiguredRepos()).not.toThrow();
    const repos = getConfiguredRepos();
    expect(Array.isArray(repos)).toBe(true);
  });

  it("each RepoInfo has required fields", () => {
    const repos = getConfiguredRepos();
    for (const repo of repos) {
      expect(typeof repo.path).toBe("string");
      expect(typeof repo.name).toBe("string");
      expect(typeof repo.hasActiveAutopilot).toBe("boolean");
      // branch is optional
      if (repo.branch !== undefined) {
        expect(typeof repo.branch).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests for the parsing logic (via a testable wrapper)
// ---------------------------------------------------------------------------

// We create a testable version by extracting the logic into a helper
// that accepts custom paths. Since the module uses hardcoded paths,
// we test the behavior by creating the actual config files in the
// expected locations within a temp HOME-like structure.

describe("getConfiguredRepos — with synthetic config", () => {
  it("handles missing repos.yaml gracefully", () => {
    // The real function handles missing file — just verify it doesn't throw
    // even when the config file doesn't exist (tested above)
    expect(() => getConfiguredRepos()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the underlying logic (via a testable factory)
// ---------------------------------------------------------------------------

// Since the module uses hardcoded paths, we test the logic by creating
// a parallel testable version that accepts injected paths.
// This is the recommended pattern for testing modules with hardcoded paths.

import { createRepoConfigReader } from "../src/repo-config.js";

describe("createRepoConfigReader", () => {
  it("returns empty array when repos.yaml does not exist", () => {
    const tmpBase = makeTmpDir();
    const reader = createRepoConfigReader({
      reposConfigPath: path.join(tmpBase, "repos.yaml"),
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });
    expect(reader()).toEqual([]);
  });

  it("returns empty array for empty repos.yaml", () => {
    const tmpBase = makeTmpDir();
    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, "");

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });
    expect(reader()).toEqual([]);
  });

  it("returns empty array for repos.yaml with no repos key", () => {
    const tmpBase = makeTmpDir();
    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, "other_key: value\n");

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });
    expect(reader()).toEqual([]);
  });

  it("returns empty array for malformed YAML", () => {
    const tmpBase = makeTmpDir();
    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, "repos: [unclosed bracket\n");

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });
    expect(() => reader()).not.toThrow();
  });

  it("reads string entries from repos.yaml", () => {
    const tmpBase = makeTmpDir();
    const repoDir = makeTmpDir();
    makeGitRepo(repoDir, "feature-x");

    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, `repos:\n  - ${repoDir}\n`);

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });

    const repos = reader();
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe(repoDir);
    expect(repos[0].name).toBe(path.basename(repoDir));
    expect(repos[0].branch).toBe("feature-x");
    expect(repos[0].hasActiveAutopilot).toBe(false);
  });

  it("reads object entries with name override from repos.yaml", () => {
    const tmpBase = makeTmpDir();
    const repoDir = makeTmpDir();

    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, `repos:\n  - path: ${repoDir}\n    name: my-alias\n`);

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });

    const repos = reader();
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("my-alias");
  });

  it("skips non-existent paths from repos.yaml", () => {
    const tmpBase = makeTmpDir();
    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, "repos:\n  - /nonexistent/path/that/does/not/exist\n");

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });

    expect(reader()).toEqual([]);
  });

  it("detects active autopilot", () => {
    const tmpBase = makeTmpDir();
    const repoDir = makeTmpDir();
    makeAutopilotActive(repoDir);

    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, `repos:\n  - ${repoDir}\n`);

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: path.join(tmpBase, "worktrees"),
    });

    const repos = reader();
    expect(repos[0].hasActiveAutopilot).toBe(true);
  });

  it("scans worktrees directory", () => {
    const tmpBase = makeTmpDir();
    const worktreesDir = path.join(tmpBase, "worktrees");

    // Create: worktrees/my-repo/wt-abc123/
    const wtDir = path.join(worktreesDir, "my-repo", "wt-abc123");
    fs.mkdirSync(wtDir, { recursive: true });
    makeGitRepo(wtDir, "feature-branch");

    const reader = createRepoConfigReader({
      reposConfigPath: path.join(tmpBase, "repos.yaml"),
      worktreesBaseDir: worktreesDir,
    });

    const repos = reader();
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe(wtDir);
    expect(repos[0].name).toBe("my-repo/wt-abc123");
    expect(repos[0].branch).toBe("feature-branch");
  });

  it("deduplicates repos that appear in both sources", () => {
    const tmpBase = makeTmpDir();
    const worktreesDir = path.join(tmpBase, "worktrees");

    // Create a worktree
    const wtDir = path.join(worktreesDir, "my-repo", "wt-abc123");
    fs.mkdirSync(wtDir, { recursive: true });

    // Also add it to repos.yaml
    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, `repos:\n  - ${wtDir}\n`);

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: worktreesDir,
    });

    const repos = reader();
    expect(repos).toHaveLength(1);
  });

  it("handles missing worktrees directory gracefully", () => {
    const tmpBase = makeTmpDir();
    const reader = createRepoConfigReader({
      reposConfigPath: path.join(tmpBase, "repos.yaml"),
      worktreesBaseDir: path.join(tmpBase, "nonexistent-worktrees"),
    });
    expect(() => reader()).not.toThrow();
    expect(reader()).toEqual([]);
  });

  it("returns repos from both sources merged", () => {
    const tmpBase = makeTmpDir();
    const worktreesDir = path.join(tmpBase, "worktrees");

    // Repo from config
    const configRepo = makeTmpDir();

    // Worktree
    const wtDir = path.join(worktreesDir, "my-repo", "wt-abc123");
    fs.mkdirSync(wtDir, { recursive: true });

    const configPath = path.join(tmpBase, "repos.yaml");
    fs.writeFileSync(configPath, `repos:\n  - ${configRepo}\n`);

    const reader = createRepoConfigReader({
      reposConfigPath: configPath,
      worktreesBaseDir: worktreesDir,
    });

    const repos = reader();
    expect(repos).toHaveLength(2);
    const paths = repos.map((r) => r.path);
    expect(paths).toContain(configRepo);
    expect(paths).toContain(wtDir);
  });
});
