import { command, option, flag, optional, string } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { buildCommands, buildAllSkills, SKILLS, BUILTIN_COLLISIONS } from "../skills/index.js";
import { ok, okErr, info, warn, yellow } from "../lib/fmt.js";
import { VERSION } from "../lib/version.js";
import { getSetting } from "../lib/settings.js";
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
  version?: string;
  prefix?: string;
  format?: "skills" | "commands";
  commands: string[];
  skills: string[];
}

function readManifest(claudeDir: string): Manifest {
  const p = path.join(claudeDir, MANIFEST_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      version: data?.version,
      prefix: data?.prefix,
      format: data?.format === "skills" || data?.format === "commands" ? data.format : undefined,
      commands: Array.isArray(data?.commands) ? data.commands : [],
      skills: Array.isArray(data?.skills) ? data.skills : [],
    };
  } catch {
    return { commands: [], skills: [] };
  }
}

function writeManifest(claudeDir: string, manifest: Manifest): void {
  const finalPath = path.join(claudeDir, MANIFEST_FILE);
  const tmpPath = finalPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmpPath, finalPath);
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
    // Guard against path traversal (e.g., "../../etc/passwd")
    if (!path.resolve(dest).startsWith(path.resolve(baseDir))) {
      throw new Error(`Path traversal detected: "${name}" escapes base directory`);
    }
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


export interface InstallPlan {
  claudeDir: string;
  commands: Record<string, string>;
  skills: Record<string, string>;
  previousManifest: Manifest;
  prefix: string | undefined;
  format: "skills" | "commands";
  force: boolean;
  collisions: string[];
  scope: "project" | "user";
}

/** Build a plan describing what to install, without performing any filesystem writes. */
export function computeInstallPlan(opts: {
  claudeDir: string;
  prefix: string | undefined;
  force: boolean;
  scope?: "project" | "user";
  format?: "skills" | "commands";
  readManifestFn?: (dir: string) => Manifest;
  existsFn?: (path: string) => boolean;
  readFileFn?: (path: string) => string;
}): InstallPlan {
  const {
    claudeDir,
    prefix,
    force,
    scope = "project",
    format = "skills",
    readManifestFn = readManifest,
    existsFn = fs.existsSync,
    readFileFn = (p: string) => fs.readFileSync(p, "utf-8"),
  } = opts;

  const previousManifest = readManifestFn(claudeDir);

  // In "skills" format, everything goes to .claude/skills/<name>/SKILL.md
  // In "commands" format (legacy), commands go to .claude/commands/ and skills to .claude/skills/
  const commands = format === "commands" ? buildCommands(prefix || undefined) : {};
  const skills = format === "skills" ? buildAllSkills(prefix || undefined) : { ...SKILLS };

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
    prefix,
    format,
    force,
    collisions,
    scope,
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
  let skillRemoved = removeStaleFiles(plan.skills, plan.previousManifest.skills, skillsDir);

  // Format migration cleanup: when migrating from commands→skills format,
  // old flat skill files (e.g., "browser.md") won't match new directory paths
  // (e.g., "browser/SKILL.md"). Explicitly remove orphaned flat files.
  if (plan.format === "skills" && plan.previousManifest.format !== "skills") {
    for (const oldSkill of plan.previousManifest.skills) {
      // Only clean up flat files (no "/" = old format); directory entries are handled above
      if (!oldSkill.includes("/")) {
        const dest = path.join(skillsDir, oldSkill);
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
          skillRemoved++;
        }
      }
    }
    // Also clean up old commands dir files during migration
    for (const oldCmd of plan.previousManifest.commands) {
      const dest = path.join(commandsDir, oldCmd);
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
        skillRemoved++;
      }
    }
  }

  // Install files
  const cmdResult = installFiles(plan.commands, commandsDir, plan.force);
  const skillResult = installFiles(plan.skills, skillsDir, plan.force);

  // Update manifest with version stamp, prefix, and format for auto-sync
  writeManifest(plan.claudeDir, {
    version: VERSION,
    prefix: plan.prefix || "",
    format: plan.format,
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
    target: plan.scope === "user" ? "~/.claude/" : ".claude/",
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

/** Sync a single scope if its manifest version doesn't match the current VERSION. */
function syncScope(claudeDir: string, scope: "user" | "project"): boolean {
  const manifest = readManifest(claudeDir);
  // Trigger sync on version mismatch OR format migration (old manifests lack format field)
  if (manifest.version === VERSION && manifest.format === "skills") return false;

  const prefix = manifest.prefix ?? undefined;
  const plan = computeInstallPlan({ claudeDir, prefix, force: false, scope, format: "skills" });
  const result = executeInstall(plan);

  if (result.created > 0 || result.updated > 0 || result.removed > 0) {
    okErr(`skills synced to v${VERSION} (${result.target})`);
  }
  return true;
}

/**
 * Auto-sync skills when CLI version doesn't match installed manifest version.
 * - User scope: auto-installs on first run (no manifest) or syncs on version mismatch
 * - Project scope: syncs only if previously installed (manifest exists with commands)
 * - Never throws — all errors silently swallowed
 * - Controlled by `skills.auto-update` setting (default: "true")
 */
export function autoSyncSkills(opts?: {
  getSettingFn?: (key: string) => string | undefined;
  homeDirFn?: () => string;
  gitRootFn?: () => string;
}): { userSynced: boolean; projectSynced: boolean } {
  const result = { userSynced: false, projectSynced: false };
  try {
    const getSettingFn = opts?.getSettingFn ?? getSetting;
    if (getSettingFn("skills.auto-update") === "false") return result;

    const homeDir = opts?.homeDirFn?.() ?? os.homedir();
    const rootFn = opts?.gitRootFn ?? gitRoot;

    // User scope — sync if stale, auto-install if first run
    const userDir = path.join(homeDir, ".claude");
    result.userSynced = syncScope(userDir, "user");

    // Project scope — sync only if previously installed
    try {
      const projectDir = path.join(rootFn(), ".claude");
      const projectManifest = readManifest(projectDir);
      if (projectManifest.commands.length > 0 || projectManifest.skills.length > 0) {
        result.projectSynced = syncScope(projectDir, "project");
      }
    } catch {
      // Not in a git repo — skip project scope
    }
  } catch {
    // Never crash the CLI for a skill sync
  }
  return result;
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

/** Validate a SKILL.md file content for required structure. */
export function validateSkill(content: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Must start with frontmatter
  if (!content.startsWith("---")) {
    errors.push("missing frontmatter (must start with ---)");
  }

  // Extract frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    errors.push("malformed frontmatter (no closing ---)");
    return { valid: false, errors };
  }

  const fm = fmMatch[1];

  // Must have name field
  if (!/^name:/m.test(fm)) {
    errors.push("missing name field in frontmatter");
  }

  // Must have description field
  if (!/^description:/m.test(fm)) {
    errors.push("missing description field in frontmatter");
  }

  return { valid: errors.length === 0, errors };
}

/** Test trigger phrases against a skill description. */
export function testTriggers(
  description: string,
  shouldTrigger: string[],
  shouldNotTrigger: string[],
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const descLower = description.toLowerCase();

  for (const phrase of shouldTrigger) {
    if (!descLower.includes(phrase.toLowerCase())) {
      failures.push(`should trigger on "${phrase}" but description doesn't contain it`);
    }
  }

  for (const phrase of shouldNotTrigger) {
    if (descLower.includes(phrase.toLowerCase())) {
      failures.push(`should NOT trigger on "${phrase}" but description contains it`);
    }
  }

  return { passed: failures.length === 0, failures };
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
    prefix: option({
      type: optional(string),
      long: "prefix",
      description:
        "Prefix for skill names (e.g. --prefix gs- for legacy names). Default: no prefix.",
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
    let plan = computeInstallPlan({ claudeDir, prefix, force, scope });

    // 3. Check for built-in collisions
    const builtinHits = Object.keys(plan.commands).filter((n) => BUILTIN_COLLISIONS.has(n));
    if (builtinHits.length > 0) {
      warn(`${builtinHits.length} skill name${builtinHits.length === 1 ? "" : "s"} would collide with Claude Code built-in commands:`);
      for (const h of builtinHits) {
        console.log(`  ${yellow(h.replace(".md", ""))}`);
      }
      console.log("");
      warn("These skills may be shadowed by built-in commands. Consider using --prefix to avoid collisions.");
      console.log("");
    }

    // 4. Handle file collisions
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
        "Use --prefix gs- to avoid collisions? [y/N] ",
      );
      if (usePrefix) {
        plan = computeInstallPlan({ claudeDir, prefix: "gs-", force, scope });
      }
    }

    // 5. Execute
    const result = executeInstall(plan);

    // 6. Print
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
