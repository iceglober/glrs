/**
 * Changeset generator for the autopilot (item 4.6).
 *
 * After all phases complete successfully, the autopilot generates a
 * changeset file in the repo's `.changeset/` directory. The file follows
 * Changesets v2 format:
 *
 *     ---
 *     "@glrs-dev/harness-plugin-opencode": <bump-level>
 *     ---
 *
 *     <description>
 *
 * Bump-level inference (per the wave_4 spec):
 *   - "fix"/"bug" in title → patch
 *   - "remove"/"break"/"v2" in title → major
 *   - otherwise → minor (default)
 *
 * The package name is hard-coded to `@glrs-dev/harness-plugin-opencode`
 * — the autopilot only ships changesets for that package today.
 *
 * Filename format: `<slug>-<random6>.md` to avoid collisions when the
 * same plan re-runs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { hasSpec, readSpecTitle, readSpecGoal } from "./spec-parser.js";

const TARGET_PACKAGE = "@glrs-dev/harness-plugin-opencode";

export type BumpLevel = "patch" | "minor" | "major";

export interface GenerateChangesetResult {
  /** Absolute path of the generated changeset file. */
  path: string;
  /** The contents written to the file. */
  content: string;
  /** Bump level chosen. */
  bumpLevel: BumpLevel;
}

export interface GenerateChangesetOptions {
  /** Override the package name (default: "@glrs-dev/harness-plugin-opencode"). */
  packageName?: string;
  /**
   * Test-only: deterministic random suffix for filename collision avoidance.
   * @internal
   */
  _randomSuffix?: () => string;
}

/**
 * Read the plan's title (first H1) from main.md (multi-file plan) or
 * the file itself (single-file plan). Returns `""` on read failure or
 * if no H1 is present.
 */
export function readPlanTitle(planPath: string): string {
  try {
    const stat = fs.statSync(planPath);
    // YAML spec path: read title from spec/main.yaml when available
    if (stat.isDirectory() && hasSpec(planPath)) {
      const yamlTitle = readSpecTitle(planPath);
      if (yamlTitle) return yamlTitle;
    }
    const target = stat.isDirectory()
      ? path.join(planPath, "main.md")
      : planPath;
    const content = fs.readFileSync(target, "utf-8");
    const match = content.match(/^#\s+(.+?)\s*$/m);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

/**
 * Read the plan's `## Goal` section (used as the changeset body).
 * Returns the title as a fallback when no Goal section is present.
 */
export function readPlanGoal(planPath: string): string {
  try {
    const stat = fs.statSync(planPath);
    // YAML spec path: read goal from spec/main.yaml when available
    if (stat.isDirectory() && hasSpec(planPath)) {
      const yamlGoal = readSpecGoal(planPath);
      if (yamlGoal) return yamlGoal;
    }
    const target = stat.isDirectory()
      ? path.join(planPath, "main.md")
      : planPath;
    const content = fs.readFileSync(target, "utf-8");
    const re = /^##\s+Goal\s*\n([\s\S]*?)(?=^##\s|$)/m;
    const match = content.match(re);
    if (match) {
      return match[1].trim().replace(/\s+/g, " ");
    }
    return readPlanTitle(planPath);
  } catch {
    return "";
  }
}

/**
 * Infer the changeset bump level from the plan title.
 *
 * The matching is case-insensitive and substring-based against a small
 * keyword set. Order matters: major > patch > minor (so a title like
 * "remove buggy fix" is major, not patch).
 */
export function inferBumpLevel(title: string): BumpLevel {
  const t = title.toLowerCase();
  if (
    t.includes("remove ") ||
    t.includes("removal") ||
    t.includes("breaking") ||
    t.includes("break ") ||
    /\bv2\b/.test(t) ||
    /\bv\d+\b/.test(t.replace(/v1\b/, "")) // any vN with N>1
  ) {
    return "major";
  }
  if (
    /\bfix\b/.test(t) ||
    /\bbug(s|fix)?\b/.test(t) ||
    t.includes("hotfix")
  ) {
    return "patch";
  }
  return "minor";
}

/**
 * Derive a URL-safe slug from a title. Lowercase, non-alphanumeric runs
 * become `-`, truncated to 40 chars. Falls back to "autopilot" when the
 * title is empty.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "autopilot";
}

/**
 * Six-character random suffix using the same alphabet Changesets uses.
 */
function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Generate a Changesets v2 changeset file for a completed plan.
 *
 * Writes to `<repoRoot>/.changeset/<slug>-<random6>.md`. Creates the
 * `.changeset/` directory if missing (Changesets ships with one but
 * this is defensive in case a worktree drops it).
 */
export async function generateChangeset(
  planPath: string,
  repoRoot: string,
  opts: GenerateChangesetOptions = {},
): Promise<GenerateChangesetResult> {
  const packageName = opts.packageName ?? TARGET_PACKAGE;
  const randomSuffix = opts._randomSuffix ?? defaultRandomSuffix;

  const title = readPlanTitle(planPath) || "Autopilot run";
  const goal = readPlanGoal(planPath) || title;
  const bumpLevel = inferBumpLevel(title);
  const slug = slugifyTitle(title);

  const content = `---
"${packageName}": ${bumpLevel}
---

${goal}
`;

  const changesetDir = path.join(repoRoot, ".changeset");
  if (!fs.existsSync(changesetDir)) {
    fs.mkdirSync(changesetDir, { recursive: true });
  }

  const filename = `${slug}-${randomSuffix()}.md`;
  const filePath = path.join(changesetDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");

  return { path: filePath, content, bumpLevel };
}
