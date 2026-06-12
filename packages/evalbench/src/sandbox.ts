/**
 * sandbox — per-run isolation for eval fixtures.
 *
 * Each run gets:
 *   <runDir>/worktree/   — throwaway git worktree of the fixture repo at its pinned ref
 *   <runDir>/xdg/        — isolated XDG_CONFIG_HOME whose opencode.json points the
 *                          plugin at THIS repo's locally built harness dist (the
 *                          config under test), with the real Linear MCP swapped for
 *                          the fixture-backed mock when the manifest asks for it
 *   <runDir>/linear-state/ — mock-MCP mutation recordings
 *
 * The user's real ~/.config/opencode is read once as a template (providers,
 * plugins config) and never written.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export const GLRS_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const HARNESS_DIST = path.join(GLRS_ROOT, "packages", "harness-opencode", "dist");
const MOCK_LINEAR = path.join(GLRS_ROOT, "packages", "evalbench", "src", "mock-linear.ts");

function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function createWorktree(
  runDir: string,
  repoSource: string,
  ref: string,
  setup: string[] | undefined,
): string {
  const repo = repoSource === "glrs" ? GLRS_ROOT : repoSource;
  const wt = path.join(runDir, "worktree");
  // Local CLONE, not `git worktree add`: a linked worktree's .git file points
  // at the source repo, and agents follow that absolute path out of the
  // sandbox (observed: a model grepping the main checkout instead of the
  // pinned one, getting denied, and stalling). A local clone hardlinks
  // objects (fast, cheap) and is fully self-contained.
  sh(path.dirname(repo), "git", ["clone", "--local", "--no-checkout", repo, wt]);
  sh(wt, "git", ["checkout", "--detach", ref]);
  for (const cmd of setup ?? []) {
    execFileSync("bash", ["-lc", cmd], { cwd: wt, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  return wt;
}

export function removeWorktree(_repoSource: string, runDir: string): void {
  fs.rmSync(path.join(runDir, "worktree"), { recursive: true, force: true });
}

/**
 * Assemble the isolated XDG config. Copies the user's global opencode config
 * (providers + plugin options) but repoints the harness plugin at the local
 * dist. Symlinks gcloud/gh so provider auth keeps working under the new HOME.
 */
export function assembleXdg(runDir: string, opts: { mockLinear: boolean; fixtureLinearDir?: string }): string {
  const xdg = path.join(runDir, "xdg");
  fs.mkdirSync(path.join(xdg, "opencode"), { recursive: true });

  const userCfgDir = path.join(os.homedir(), ".config", "opencode");
  // Plugin runtime deps installed in the user's config dir.
  for (const entry of ["node_modules", "package.json"]) {
    const src = path.join(userCfgDir, entry);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(xdg, "opencode", entry));
  }
  for (const tool of ["gcloud", "gh"]) {
    const src = path.join(os.homedir(), ".config", tool);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(xdg, tool));
  }

  const cfg = JSON.parse(
    fs.readFileSync(path.join(userCfgDir, "opencode.json"), "utf8"),
  ) as Record<string, unknown>;

  // Repoint the harness plugin at the local build.
  const plugins = (cfg["plugin"] as unknown[]) ?? [];
  cfg["plugin"] = plugins.map((p) => {
    if (Array.isArray(p) && String(p[0]).includes("harness")) return [`file://${HARNESS_DIST}`, p[1]];
    if (typeof p === "string" && p.includes("harness")) return `file://${HARNESS_DIST}`;
    return p;
  });

  fs.writeFileSync(path.join(xdg, "opencode", "opencode.json"), JSON.stringify(cfg, null, 2));
  return xdg;
}

/**
 * Project-level opencode.json written INTO the eval worktree: the mock Linear
 * MCP (when enabled) plus permissive-but-safe bash permissions mirroring real
 * project configs.
 */
export function writeWorktreeConfig(
  wt: string,
  runDir: string,
  opts: { mockLinear: boolean; fixtureLinearDir?: string },
): void {
  const cfg: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    permission: {
      bash: {
        "*": "allow",
        "git push *": "deny",
        "rm -rf *": "deny",
        "sudo *": "deny",
      },
    },
  };
  if (opts.mockLinear) {
    cfg["mcp"] = {
      linear: {
        type: "local",
        command: ["bun", MOCK_LINEAR],
        enabled: true,
        environment: {
          MOCK_LINEAR_FIXTURE_DIR: opts.fixtureLinearDir ?? "",
          MOCK_LINEAR_STATE_DIR: path.join(runDir, "linear-state"),
        },
      },
    };
  }
  fs.writeFileSync(path.join(wt, "opencode.json"), JSON.stringify(cfg, null, 2));
}

export function readMutations(runDir: string): { tool: string; args: unknown }[] {
  const p = path.join(runDir, "linear-state", "mutations.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { tool: string; args: unknown });
}
