import { command, flag } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { COMMANDS, SKILLS } from "../skills/index.js";
import { ok, info, warn, yellow } from "../lib/fmt.js";
import { gitRoot } from "../lib/git.js";

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

/**
 * Find files that would be overwritten and whose content doesn't match
 * what glorious would install — these are potential collisions with
 * user-created or third-party skill files.
 */
function findCollisions(
  files: Record<string, string>,
  previousFiles: string[],
  baseDir: string,
): string[] {
  const previousSet = new Set(previousFiles);
  const collisions: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    // Skip files we previously installed — those are updates, not collisions
    if (previousSet.has(name)) continue;
    const dest = path.join(baseDir, name);
    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, "utf-8");
      if (existing !== content) {
        collisions.push(name);
      }
    }
  }
  return collisions;
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
    prefix: flag({
      long: "prefix",
      description:
        "Install all skills under a glorious/ subdirectory (e.g. work → glorious/work)",
    }),
  },
  handler: async ({ force, user, prefix }) => {
    let claudeDir: string;

    if (user) {
      claudeDir = path.join(os.homedir(), ".claude");
    } else {
      let root: string;
      try {
        root = gitRoot();
      } catch {
        console.error("Not in a git repository (use --user to install globally)");
        process.exit(1);
      }
      claudeDir = path.join(root, ".claude");
    }

    const commandsDir = path.join(claudeDir, "commands");
    const skillsDir = path.join(claudeDir, "skills");
    const manifest = readManifest(claudeDir);

    // Check for collisions if --prefix wasn't specified
    let usePrefix = prefix;
    if (!usePrefix && !force) {
      const cmdCollisions = findCollisions(COMMANDS, manifest.commands, commandsDir);
      const skillCollisions = findCollisions(SKILLS, manifest.skills, skillsDir);
      const allCollisions = [
        ...cmdCollisions.map((n) => `commands/${n}`),
        ...skillCollisions.map((n) => `skills/${n}`),
      ];

      if (allCollisions.length > 0) {
        warn(`${allCollisions.length} file${allCollisions.length === 1 ? "" : "s"} would collide with existing files:`);
        for (const c of allCollisions.slice(0, 5)) {
          console.log(`  ${yellow(c)}`);
        }
        if (allCollisions.length > 5) {
          console.log(`  ... and ${allCollisions.length - 5} more`);
        }
        console.log("");
        usePrefix = await askYesNo(
          "Use --prefix to organize into subdirectories and avoid collisions? [y/N] ",
        );
      }
    }

    const commands = usePrefix ? addGloriousPrefix(COMMANDS) : COMMANDS;
    const skills = usePrefix ? addGloriousPrefix(SKILLS) : SKILLS;

    // Remove stale files from previous install
    const cmdRemoved = removeStaleFiles(commands, manifest.commands, commandsDir);
    const skillRemoved = removeStaleFiles(skills, manifest.skills, skillsDir);
    const totalRemoved = cmdRemoved + skillRemoved;

    // Install commands
    const cmdResult = installFiles(commands, commandsDir, force);
    // Install skills
    const skillResult = installFiles(skills, skillsDir, force);

    // Update manifest
    writeManifest(claudeDir, {
      commands: Object.keys(commands),
      skills: Object.keys(skills),
    });

    const totalCreated = cmdResult.created + skillResult.created;
    const totalUpdated = cmdResult.updated + skillResult.updated;
    const totalUpToDate = cmdResult.upToDate + skillResult.upToDate;

    const target = user ? "~/.claude/" : ".claude/";

    if (totalCreated > 0) {
      ok(`created ${totalCreated} new file${totalCreated === 1 ? "" : "s"} in ${target}`);
    }
    if (totalUpdated > 0) {
      ok(`updated ${totalUpdated} file${totalUpdated === 1 ? "" : "s"} in ${target}`);
    }
    if (totalRemoved > 0) {
      ok(`removed ${totalRemoved} stale file${totalRemoved === 1 ? "" : "s"} from ${target}`);
    }
    if (totalUpToDate > 0 && totalCreated === 0 && totalUpdated === 0 && totalRemoved === 0) {
      ok("all skills up to date");
    }

    // List commands
    const commandNames = Object.keys(commands);
    console.log("");
    info("commands:");
    for (const name of commandNames) {
      const slug = name.replace(".md", "").replace(/\//g, ":");
      console.log(`  /${slug}`);
    }

    // List skills
    const skillNames = Object.keys(skills);
    if (skillNames.length > 0) {
      console.log("");
      info("skills:");
      for (const name of skillNames) {
        const slug = name.replace(".md", "").replace(/\//g, ":");
        console.log(`  /${slug}`);
      }
    }

  },
});
