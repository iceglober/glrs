/**
 * Plan-parser module for the autopilot engine.
 *
 * Parses both single-file plans (one .md file with checkboxes or a
 * plan-state fence) and multi-file plans (a directory containing
 * main.md + phase_N.md files). Returns structured progress data.
 *
 * Never throws — all errors degrade to zero-count results so the
 * loop's heartbeat can fall back to plan-blind mode safely.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { hasSpec, parseSpecState } from "./spec-parser.js";

export interface PlanPhase {
  file: string;
  totalItems: number;
  checkedItems: number;
}

export interface PlanState {
  type: "single" | "multi";
  totalItems: number;
  checkedItems: number;
  phaseCount: number;
  phasesCompleted: number;
  phases: PlanPhase[];
}

export interface PlanFileEntry {
  path: string;
  isNew: boolean;
  change: string;
}

export interface PlanItem {
  id: string;
  intent: string;
  files: PlanFileEntry[];
  tests: string[];
  verify: string;
  checked: boolean;
  proof?: string;
  proof_type?: string;
}

const DEGRADED: PlanState = {
  type: "single",
  totalItems: 0,
  checkedItems: 0,
  phaseCount: 0,
  phasesCompleted: 0,
  phases: [],
};

/**
 * Count checked and total checkbox items in a markdown string.
 * Handles both plain `- [ ]` / `- [x]` bullets and items inside
 * fenced `plan-state` blocks.
 */
function countCheckboxes(content: string): { total: number; checked: number } {
  let total = 0;
  let checked = 0;

  // Match both plain markdown checkboxes and fenced plan-state items.
  // Pattern: optional leading whitespace, then `- [ ]` or `- [x]`
  const checkboxRe = /^[ \t]*-\s+\[([ xX])\]/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(content)) !== null) {
    total++;
    if (match[1] !== " ") {
      checked++;
    }
  }

  return { total, checked };
}

/**
 * Parse a single markdown file and return its checkbox counts.
 */
function parseSingleFile(filePath: string): { total: number; checked: number } {
  const content = fs.readFileSync(filePath, "utf8");
  return countCheckboxes(content);
}

/**
 * Detect phase files in a plan directory.
 * Returns sorted list of phase_N.md filenames.
 */
function detectPhaseFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir);
  return entries
    .filter((f) => f.endsWith(".md") && f !== "main.md" && f !== "scope.md" && f !== "scope-seed.md")
    .sort((a, b) => {
      const na = parseInt(a.replace(/[^0-9]/g, ""), 10);
      const nb = parseInt(b.replace(/[^0-9]/g, ""), 10);
      return na - nb;
    });
}

/**
 * Parse a multi-file plan directory (main.md + phase_N.md files).
 */
function parseMultiFile(dir: string): PlanState {
  const mainPath = path.join(dir, "main.md");
  const mainContent = fs.readFileSync(mainPath, "utf8");
  const mainCounts = countCheckboxes(mainContent);

  const phaseFiles = detectPhaseFiles(dir);
  const phases: PlanPhase[] = [];
  let phasesCompleted = 0;

  for (const phaseFile of phaseFiles) {
    const phasePath = path.join(dir, phaseFile);
    const { total, checked } = parseSingleFile(phasePath);
    phases.push({ file: phaseFile, totalItems: total, checkedItems: checked });
    if (total > 0 && checked === total) {
      phasesCompleted++;
    }
  }

  return {
    type: "multi",
    totalItems: mainCounts.total,
    checkedItems: mainCounts.checked,
    phaseCount: phaseFiles.length,
    phasesCompleted,
    phases,
  };
}

/**
 * Parse a plan at the given path and return structured progress data.
 *
 * - If `planPath` is a directory containing `main.md`, it's treated as
 *   a multi-file plan.
 * - If `planPath` is a `.md` file, it's treated as a single-file plan.
 * - Any error (missing file, parse failure, etc.) returns a degraded
 *   result with zero counts — never throws.
 */
export function parsePlanState(planPath: string): PlanState {
  try {
    const stat = fs.statSync(planPath);

    // Route to YAML spec parser when spec/main.yaml exists
    if (stat.isDirectory() && hasSpec(planPath)) {
      return parseSpecState(planPath);
    }

    if (stat.isDirectory()) {
      const mainPath = path.join(planPath, "main.md");
      // If directory has main.md, it's a multi-file plan
      if (fs.existsSync(mainPath)) {
        return parseMultiFile(planPath);
      }
      // Directory without main.md — degrade
      return { ...DEGRADED, type: "multi" };
    }

    // Single file
    const { total, checked } = parseSingleFile(planPath);
    return {
      type: "single",
      totalItems: total,
      checkedItems: checked,
      phaseCount: 0,
      phasesCompleted: 0,
      phases: [],
    };
  } catch {
    return { ...DEGRADED };
  }
}

/**
 * Extract the content of a fenced ```plan-state``` block from a markdown string.
 * Returns null if no fence is found.
 */
function extractPlanStateFence(content: string): string | null {
  const fenceRe = /^```plan-state\r?\n([\s\S]*?)^```/m;
  const match = fenceRe.exec(content);
  return match ? match[1] : null;
}

/**
 * Parse individual plan items from a plan-state fence block.
 *
 * Each item starts with `- [ ] id:` or `- [x] id:` and contains
 * optional `intent:`, `files:`, `tests:`, and `verify:` fields.
 *
 * Returns an empty array if no fence is found or the content is malformed.
 * Never throws.
 */
export function parseItems(content: string): PlanItem[] {
  try {
    const fence = extractPlanStateFence(content);
    if (!fence) return [];

    const items: PlanItem[] = [];

    // Split on item boundaries: lines starting with `- [ ]` or `- [x]`
    const itemBlocks = fence.split(/(?=^- \[[ xX]\])/m).filter((b) => b.trim());

    for (const block of itemBlocks) {
      const lines = block.split("\n");
      const firstLine = lines[0];

      // Determine checked state and extract id from first line
      const headerMatch = /^- \[([ xX])\]\s+id:\s*(.+)$/.exec(firstLine.trim());
      if (!headerMatch) continue;

      const checked = headerMatch[1] !== " ";
      const id = headerMatch[2].trim();

      let intent = "";
      let verify = "";
      const files: PlanFileEntry[] = [];
      const tests: string[] = [];

      let i = 1;
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith("intent:")) {
          intent = trimmed.slice("intent:".length).trim();
          i++;
        } else if (trimmed === "files:") {
          i++;
          // Parse file entries: `    - <path> [(NEW)]` followed by `      Change: <text>`
          while (i < lines.length) {
            const fileLine = lines[i];
            const fileMatch = /^\s{4}-\s+(.+)$/.exec(fileLine);
            if (!fileMatch) break;

            const rawPath = fileMatch[1].trim();
            const isNew = rawPath.includes("(NEW)");
            const cleanPath = rawPath.replace(/\s*\(NEW\)\s*/, "").trim();

            i++;
            // Next line should be `      Change: <text>` (6 spaces indent)
            let change = "";
            if (i < lines.length) {
              const changeLine = lines[i];
              const changeMatch = /^\s{6}Change:\s*(.+)$/.exec(changeLine);
              if (changeMatch) {
                change = changeMatch[1].trim();
                i++;
              }
            }

            files.push({ path: cleanPath, isNew, change });
          }
        } else if (trimmed === "tests:") {
          i++;
          while (i < lines.length) {
            const testLine = lines[i];
            const testMatch = /^\s{4}-\s+(.+)$/.exec(testLine);
            if (!testMatch) break;
            tests.push(testMatch[1].trim());
            i++;
          }
        } else if (trimmed.startsWith("verify:")) {
          verify = trimmed.slice("verify:".length).trim();
          i++;
        } else {
          i++;
        }
      }

      items.push({ id, intent, files, tests, verify, checked });
    }

    return items;
  } catch {
    return [];
  }
}
