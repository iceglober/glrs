/**
 * Plan-parser module for the autopilot engine.
 *
 * Parses plan state from YAML spec directories. Returns structured
 * progress data.
 *
 * Never throws — all errors degrade to zero-count results so the
 * loop's heartbeat can fall back to plan-blind mode safely.
 */

import * as fs from "node:fs";
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
 * Extract the content of a fenced ```plan-state``` block from a markdown string.
 * Returns null if no fence is found.
 * @deprecated Used only by the legacy parseItems parser.
 */
function extractPlanStateFence(content: string): string | null {
  const fenceRe = /^```plan-state\r?\n([\s\S]*?)^```/m;
  const match = fenceRe.exec(content);
  return match ? match[1] : null;
}

/**
 * Parse individual plan items from a plan-state fence block.
 * @deprecated Prefer parseSpecItems from spec-parser.ts for YAML spec plans.
 */
export function parseItems(content: string): PlanItem[] {
  try {
    const fence = extractPlanStateFence(content);
    if (!fence) return [];

    const items: PlanItem[] = [];
    const itemBlocks = fence.split(/(?=^- \[[ xX]\])/m).filter((b) => b.trim());

    for (const block of itemBlocks) {
      const lines = block.split("\n");
      const firstLine = lines[0];

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
        const trimmed = lines[i].trim();

        if (trimmed.startsWith("intent:")) {
          intent = trimmed.slice("intent:".length).trim();
          i++;
        } else if (trimmed === "files:") {
          i++;
          while (i < lines.length) {
            const fileMatch = /^\s{4}-\s+(.+)$/.exec(lines[i]);
            if (!fileMatch) break;
            const rawPath = fileMatch[1].trim();
            const isNew = rawPath.includes("(NEW)");
            const cleanPath = rawPath.replace(/\s*\(NEW\)\s*/, "").trim();
            i++;
            let change = "";
            if (i < lines.length) {
              const changeMatch = /^\s{6}Change:\s*(.+)$/.exec(lines[i]);
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
            const testMatch = /^\s{4}-\s+(.+)$/.exec(lines[i]);
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

/**
 * Parse a plan at the given path and return structured progress data.
 *
 * - If `planPath` is a directory with spec/main.yaml, delegates to
 *   the YAML spec parser.
 * - Otherwise returns a degraded result with zero counts.
 * - Never throws.
 */
export function parsePlanState(planPath: string): PlanState {
  try {
    const stat = fs.statSync(planPath);

    if (stat.isDirectory() && hasSpec(planPath)) {
      return parseSpecState(planPath);
    }

    return { ...DEGRADED, type: stat.isDirectory() ? "multi" : "single" };
  } catch {
    return { ...DEGRADED };
  }
}
