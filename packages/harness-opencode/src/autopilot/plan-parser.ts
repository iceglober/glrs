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
    .filter((f) => /^phase_\d+\.md$/.test(f))
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
