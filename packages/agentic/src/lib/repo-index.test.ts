import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setSettingsPath, setSetting } from "./settings.js";

// repo-index uses the real ~/.glorious/repos.json path; redirect HOME for the
// duration of these tests so we don't pollute the user's real index.
let tmpHome: string;
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  originalCwd = process.cwd();
  tmpHome = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "gs-repoidx-")),
  );
  process.env.HOME = tmpHome;
  setSettingsPath(path.join(tmpHome, "settings.json"));
});

afterEach(() => {
  process.env.HOME = originalHome;
  process.chdir(originalCwd);
  setSettingsPath(null);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

async function fresh() {
  // Re-import so os.homedir() picks up the new HOME.
  const mod = await import(`./repo-index.js?t=${Date.now()}`);
  return mod as typeof import("./repo-index.js");
}

describe("rememberRepo / lookupRepo", () => {
  test("writes the index to ~/.glorious/repos.json and reads it back", async () => {
    const { rememberRepo, lookupRepo } = await fresh();
    const repoPath = path.join(tmpHome, "some-repo");
    fs.mkdirSync(repoPath);

    rememberRepo("some-repo", repoPath);
    expect(lookupRepo("some-repo")).toBe(repoPath);
  });

  test("returns null for unknown repos", async () => {
    const { lookupRepo } = await fresh();
    expect(lookupRepo("nope")).toBeNull();
  });

  test("prunes entries whose paths no longer exist on load", async () => {
    const { rememberRepo, lookupRepo } = await fresh();
    const repoPath = path.join(tmpHome, "gone");
    fs.mkdirSync(repoPath);
    rememberRepo("gone", repoPath);
    fs.rmSync(repoPath, { recursive: true });
    expect(lookupRepo("gone")).toBeNull();
  });
});

describe("findRepoByScan", () => {
  test("finds a repo by basename under a configured scan root and remembers it", async () => {
    const root = path.join(tmpHome, "code");
    const target = path.join(root, "my-repo");
    fs.mkdirSync(path.join(target, ".git"), { recursive: true });
    setSetting("repo.scan-roots", root);

    const { findRepoByScan, lookupRepo } = await fresh();
    const hit = findRepoByScan("my-repo");
    expect(hit).toBe(target);
    // cached for next lookup
    expect(lookupRepo("my-repo")).toBe(target);
  });

  test("walks nested directories up to the depth limit", async () => {
    const root = path.join(tmpHome, "code");
    const target = path.join(root, "org", "team", "nested-repo");
    fs.mkdirSync(path.join(target, ".git"), { recursive: true });
    setSetting("repo.scan-roots", root);

    const { findRepoByScan } = await fresh();
    expect(findRepoByScan("nested-repo")).toBe(target);
  });

  test("does not descend into .git / node_modules", async () => {
    const root = path.join(tmpHome, "code");
    const target = path.join(root, "outer");
    fs.mkdirSync(path.join(target, ".git"), { recursive: true });
    // decoy inside node_modules — should be ignored
    fs.mkdirSync(
      path.join(target, "node_modules", "outer", ".git"),
      { recursive: true },
    );
    setSetting("repo.scan-roots", root);

    const { findRepoByScan } = await fresh();
    const hit = findRepoByScan("outer");
    expect(hit).toBe(target);
  });

  test("returns null when no match is found", async () => {
    const root = path.join(tmpHome, "code");
    fs.mkdirSync(root, { recursive: true });
    setSetting("repo.scan-roots", root);

    const { findRepoByScan } = await fresh();
    expect(findRepoByScan("missing")).toBeNull();
  });

  test("silently skips scan roots that don't exist", async () => {
    const real = path.join(tmpHome, "real");
    const target = path.join(real, "my-repo");
    fs.mkdirSync(path.join(target, ".git"), { recursive: true });
    setSetting("repo.scan-roots", `${tmpHome}/does-not-exist:${real}`);

    const { findRepoByScan } = await fresh();
    expect(findRepoByScan("my-repo")).toBe(target);
  });
});
