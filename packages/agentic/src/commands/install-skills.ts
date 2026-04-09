import { command, flag } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { COMMANDS, SKILLS } from "../skills/index.js";
import { ok, info, warn, yellow } from "../lib/fmt.js";
import { gitRoot } from "../lib/git.js";
import { select } from "../lib/select.js";

const MANIFEST_FILE = ".glorious-skills.json";

/** Resolve the .claude directory for a given scope. */
export function resolveClaudeDir(
  scope: "project" | "user",
  gitRootFn?: () => string,
): string {
  if (scope === "user") {
    return path.join(os.homedir(), ".claude");
  }
  const rootFn = gitRootFn ?? gitRoot;
  return path.join(rootFn(), ".claude");
}

export interface Manifest {
  commands: string[];
  skills: string[];
}

function readManifest(claudeDir: string): Manifest {
  const p = path.join(claudeDir, MANIFEST_FILE);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { commands: [], skills: [] };
  }
}

function writeManifest(claudeDir: string, manifest: Manifest): void {
  fs.writeFileSync(
    path.join(claudeDir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

function installFiles(
  files: Record<string, string>,
  baseDir: string,
  force: boolean,
): { created: number; updated: number; upToDate: number } {
  let created = 0;
  let updated = 0;
  let upToDate = 0;

  for (const name of Object.keys(files)) {
    const dest = path.join(baseDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, "utf-8");
      if (existing === files[name] && !force) {
        upToDate++;
        continue;
      }
      fs.writeFileSync(dest, files[name]);
      updated++;
    } else {
      fs.writeFileSync(dest, files[name]);
      created++;
    }
  }

  return { created, updated, upToDate };
}

/** Remove files from a previous install that are no longer in the current set */
function removeStaleFiles(
  currentFiles: Record<string, string>,
  previousFiles: string[],
  baseDir: string,
): number {
  const currentSet = new Set(Object.keys(currentFiles));
  let removed = 0;

  for (const name of previousFiles) {
    if (currentSet.has(name)) continue;
    const dest = path.join(baseDir, name);
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
      removed++;
      // Clean up empty parent dirs
      const dir = path.dirname(dest);
      try {
        if (dir !== baseDir && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {
        // ignore — dir may not be empty or already gone
      }
    }
  }

  return removed;
}

/** Nest all skill files under a `glorious/` subdirectory */
function addGloriousPrefix(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    result[`glorious/${name}`] = content;
  }
  return result;
}


export interface InstallPlan {
  claudeDir: string;
  commands: Record<string, string>;
  skills: Record<string, string>;
  previousManifest: Manifest;
  usePrefix: boolean;
  force: boolean;
  collisions: string[];
}

/** Build a plan describing what to install, without performing any filesystem writes. */
export function computeInstallPlan(opts: {
  claudeDir: string;
  prefix: boolean;
  force: boolean;
  readManifestFn?: (dir: string) => Manifest;
  existsFn?: (path: string) => boolean;
  readFileFn?: (path: string) => string;
}): InstallPlan {
  const {
    claudeDir,
    prefix,
    force,
    readManifestFn = readManifest,
    existsFn = fs.existsSync,
    readFileFn = (p: string) => fs.readFileSync(p, "utf-8"),
  } = opts;

  const previousManifest = readManifestFn(claudeDir);
  const commands = prefix ? addGloriousPrefix(COMMANDS) : COMMANDS;
  const skills = prefix ? addGloriousPrefix(SKILLS) : SKILLS;

  let collisions: string[] = [];
  if (!force) {
    const commandsDir = path.join(claudeDir, "commands");
    const skillsDir = path.join(claudeDir, "skills");

    const findCollisionsPure = (
      files: Record<string, string>,
      previousFiles: string[],
      baseDir: string,
    ): string[] => {
      const previousSet = new Set(previousFiles);
      const result: string[] = [];
      for (const [name, content] of Object.entries(files)) {
        if (previousSet.has(name)) continue;
        const dest = path.join(baseDir, name);
        if (existsFn(dest)) {
          const existing = readFileFn(dest);
          if (existing !== content) {
            result.push(name);
          }
        }
      }
      return result;
    };

    const cmdCollisions = findCollisionsPure(commands, previousManifest.commands, commandsDir);
    const skillCollisions = findCollisionsPure(skills, previousManifest.skills, skillsDir);
    collisions = [
      ...cmdCollisions.map((n) => `commands/${n}`),
      ...skillCollisions.map((n) => `skills/${n}`),
    ];
  }

  return {
    claudeDir,
    commands,
    skills,
    previousManifest,
    usePrefix: prefix,
    force,
    collisions,
  };
}

export interface InstallResult {
  created: number;
  updated: number;
  upToDate: number;
  removed: number;
  commandNames: string[];
  skillNames: string[];
  target: string;
}

/** Execute an install plan: write files, remove stale files, update manifest. */
export function executeInstall(plan: InstallPlan): InstallResult {
  const commandsDir = path.join(plan.claudeDir, "commands");
  const skillsDir = path.join(plan.claudeDir, "skills");

  // Remove stale files from previous install
  const cmdRemoved = removeStaleFiles(plan.commands, plan.previousManifest.commands, commandsDir);
  const skillRemoved = removeStaleFiles(plan.skills, plan.previousManifest.skills, skillsDir);

  // Install files
  const cmdResult = installFiles(plan.commands, commandsDir, plan.force);
  const skillResult = installFiles(plan.skills, skillsDir, plan.force);

  // Update manifest
  writeManifest(plan.claudeDir, {
    commands: Object.keys(plan.commands),
    skills: Object.keys(plan.skills),
  });

  return {
    created: cmdResult.created + skillResult.created,
    updated: cmdResult.updated + skillResult.updated,
    upToDate: cmdResult.upToDate + skillResult.upToDate,
    removed: cmdRemoved + skillRemoved,
    commandNames: Object.keys(plan.commands),
    skillNames: Object.keys(plan.skills),
    target: plan.claudeDir.startsWith(os.homedir()) &&
      plan.claudeDir === path.join(os.homedir(), ".claude")
      ? "~/.claude/"
      : ".claude/",
  };
}

/** Format install results as human-readable lines (no ANSI — callers add formatting). */
export function formatInstallResult(result: InstallResult): string[] {
  const lines: string[] = [];

  if (result.created > 0) {
    lines.push(`created ${result.created} new file${result.created === 1 ? "" : "s"} in ${result.target}`);
  }
  if (result.updated > 0) {
    lines.push(`updated ${result.updated} file${result.updated === 1 ? "" : "s"} in ${result.target}`);
  }
  if (result.removed > 0) {
    lines.push(`removed ${result.removed} stale file${result.removed === 1 ? "" : "s"} from ${result.target}`);
  }
  if (result.upToDate > 0 && result.created === 0 && result.updated === 0 && result.removed === 0) {
    lines.push("all skills up to date");
  }

  if (result.commandNames.length > 0) {
    lines.push("");
    lines.push("commands:");
    for (const name of result.commandNames) {
      const slug = name.replace(".md", "").replace(/\//g, ":");
      lines.push(`  /${slug}`);
    }
  }

  if (result.skillNames.length > 0) {
    lines.push("");
    lines.push("skills:");
    for (const name of result.skillNames) {
      const slug = name.replace(".md", "").replace(/\//g, ":");
      lines.push(`  /${slug}`);
    }
  }

  return lines;
}

type Scope = "project" | "user";

/** Interactive scope picker. Falls back to "project" when not a TTY or on cancel. */
export async function promptScope(opts?: {
  isTTY?: boolean;
  selectFn?: (o: any) => Promise<Scope | null>;
}): Promise<Scope> {
  const isTTY = opts?.isTTY ?? process.stdin.isTTY;
  if (!isTTY) return "project";

  const selectFn = opts?.selectFn ?? (select as (o: any) => Promise<Scope | null>);
  const result = await selectFn({
    message: "Where should skills be installed?",
    groups: [
      {
        title: "Scope",
        choices: [
          { label: "~/.claude/", value: "user" as Scope, hint: "available in all projects" },
          { label: ".claude/", value: "project" as Scope, hint: "committed to this repo" },
        ],
      },
    ],
  });

  return result ?? "project";
}

/** Resolve scope from CLI flags. Returns null when interactive picker is needed. */
export function resolveScopeFromFlags(flags: {
  user: boolean;
  project: boolean;
}): "project" | "user" | null {
  if (flags.user && flags.project) {
    throw new Error("Cannot use --user and --project together");
  }
  if (flags.user) return "user";
  if (flags.project) return "project";
  return null;
}

async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

export const installSkills = command({
  name: "skills",
  description:
    "Install glorious workflow skills as Claude Code slash commands",
  args: {
    force: flag({
      long: "force",
      description: "Overwrite existing skill files",
    }),
    user: flag({
      long: "user",
      description: "Install to ~/.claude/ (user-level) instead of the current project",
    }),
    project: flag({
      long: "project",
      description: "Install to .claude/ (project-level) in the current repo",
    }),
    prefix: flag({
      long: "prefix",
      description:
        "Install all skills under a glorious/ subdirectory (e.g. work → glorious/work)",
    }),
  },
  handler: async ({ force, user, project, prefix }) => {
    // 1. Resolve scope
    let scope: "project" | "user";
    try {
      const flagScope = resolveScopeFromFlags({ user, project });
      scope = flagScope ?? await promptScope();
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }

    let claudeDir: string;
    try {
      claudeDir = resolveClaudeDir(scope);
    } catch {
      console.error("Not in a git repository (use --user to install globally)");
      process.exit(1);
    }

    // 2. Compute plan
    let plan = computeInstallPlan({ claudeDir, prefix, force });

    // 3. Handle collisions
    if (plan.collisions.length > 0 && !force) {
      warn(`${plan.collisions.length} file${plan.collisions.length === 1 ? "" : "s"} would collide with existing files:`);
      for (const c of plan.collisions.slice(0, 5)) {
        console.log(`  ${yellow(c)}`);
      }
      if (plan.collisions.length > 5) {
        console.log(`  ... and ${plan.collisions.length - 5} more`);
      }
      console.log("");
      const usePrefix = await askYesNo(
        "Use --prefix to organize into subdirectories and avoid collisions? [y/N] ",
      );
      if (usePrefix) {
        plan = computeInstallPlan({ claudeDir, prefix: true, force });
      }
    }

    // 4. Execute
    const result = executeInstall(plan);

    // 5. Print
    const lines = formatInstallResult(result);
    for (const line of lines) {
      // Re-apply formatting: status lines get ok/info prefixes
      if (line.startsWith("created") || line.startsWith("updated") || line.startsWith("removed") || line === "all skills up to date") {
        ok(line);
      } else if (line === "commands:" || line === "skills:") {
        info(line);
      } else if (line === "") {
        console.log("");
      } else {
        console.log(line);
      }
    }
  },
});
