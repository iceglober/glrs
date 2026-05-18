/**
 * YAML spec parser for the autopilot engine.
 *
 * Reads spec/main.yaml and spec/<phase>.yaml files, validates them
 * against the schema, and converts to the canonical PlanState/PlanItem
 * types used throughout the autopilot.
 *
 * Never throws — all errors degrade to zero-count results or empty
 * arrays so callers can fall back gracefully.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import type { PlanState, PlanPhase, PlanItem, PlanFileEntry } from "./plan-parser.js";
import {
  validateMainSpec,
  validatePhaseSpec,
  type MainSpec,
  type PhaseSpec,
  type SpecItem,
} from "./spec-schema.js";

const DEGRADED: PlanState = {
  type: "single",
  totalItems: 0,
  checkedItems: 0,
  phaseCount: 0,
  phasesCompleted: 0,
  phases: [],
};

/**
 * Check whether a plan directory has a YAML spec (spec/main.yaml exists).
 * This is the gate that determines whether to use the YAML path or fall
 * back to the markdown parser.
 */
export function hasSpec(planDir: string): boolean {
  try {
    return fs.existsSync(path.join(planDir, "spec", "main.yaml"));
  } catch {
    return false;
  }
}

/**
 * Convert a SpecItem (YAML shape) to a PlanItem (canonical internal type).
 */
function specItemToPlanItem(item: SpecItem): PlanItem & {
  mirror?: string;
  context?: string;
  conventions?: string;
} {
  const files: PlanFileEntry[] = (item.files ?? []).map((f) => ({
    path: f.path,
    isNew: f.isNew ?? false,
    change: f.change ?? "",
  }));

  return {
    id: item.id,
    intent: item.intent,
    checked: item.checked ?? false,
    files,
    tests: item.tests ?? [],
    verify: item.verify ?? "",
    ...(item.mirror !== undefined ? { mirror: item.mirror } : {}),
    ...(item.context !== undefined ? { context: item.context } : {}),
    ...(item.conventions !== undefined ? { conventions: item.conventions } : {}),
  };
}

/**
 * Parse a phase YAML file and return PlanItem[].
 * Returns [] on any error (missing file, invalid YAML, schema failure).
 */
export function parseSpecItems(phasePath: string): Array<PlanItem & {
  mirror?: string;
  context?: string;
  conventions?: string;
}> {
  try {
    const content = fs.readFileSync(phasePath, "utf-8");
    const raw = yamlParse(content) as unknown;
    const validation = validatePhaseSpec(raw);
    if (!validation.valid) {
      return [];
    }
    const spec = raw as PhaseSpec;
    return spec.items.map(specItemToPlanItem);
  } catch {
    return [];
  }
}

/**
 * Parse spec/main.yaml and all referenced phase files into a PlanState.
 * Returns a degraded state on any error.
 */
export function parseSpecState(planDir: string): PlanState {
  try {
    const mainPath = path.join(planDir, "spec", "main.yaml");
    if (!fs.existsSync(mainPath)) {
      return { ...DEGRADED };
    }

    const mainContent = fs.readFileSync(mainPath, "utf-8");
    const rawMain = yamlParse(mainContent) as unknown;
    const mainValidation = validateMainSpec(rawMain);
    if (!mainValidation.valid) {
      return { ...DEGRADED, type: "multi" };
    }

    const mainSpec = rawMain as MainSpec;
    const phases: PlanPhase[] = [];
    let totalItems = 0;
    let checkedItems = 0;
    let phasesCompleted = 0;

    for (const phaseRef of mainSpec.phases) {
      const phasePath = path.join(planDir, "spec", phaseRef.file);
      const items = parseSpecItems(phasePath);
      const phaseTotal = items.length;
      const phaseChecked = items.filter((it) => it.checked).length;

      phases.push({
        file: phaseRef.file,
        totalItems: phaseTotal,
        checkedItems: phaseChecked,
      });

      totalItems += phaseTotal;
      checkedItems += phaseChecked;

      if (phaseRef.completed) {
        phasesCompleted++;
      }
    }

    return {
      type: "multi",
      totalItems,
      checkedItems,
      phaseCount: mainSpec.phases.length,
      phasesCompleted,
      phases,
    };
  } catch {
    return { ...DEGRADED };
  }
}

/**
 * Detect phase files from spec/main.yaml. Returns sorted list of phase
 * filenames (e.g., ["wave_0.yaml", "wave_1.yaml"]).
 */
export function detectSpecPhases(planDir: string): string[] {
  try {
    const mainPath = path.join(planDir, "spec", "main.yaml");
    if (!fs.existsSync(mainPath)) {
      return [];
    }
    const content = fs.readFileSync(mainPath, "utf-8");
    const raw = yamlParse(content) as unknown;
    const validation = validateMainSpec(raw);
    if (!validation.valid) {
      return [];
    }
    const spec = raw as MainSpec;
    return spec.phases.map((p) => p.file);
  } catch {
    return [];
  }
}

/**
 * Read the goal field from spec/main.yaml. Returns "" on failure.
 */
export function readSpecGoal(planDir: string): string {
  try {
    const mainPath = path.join(planDir, "spec", "main.yaml");
    const content = fs.readFileSync(mainPath, "utf-8");
    const raw = yamlParse(content) as unknown;
    if (typeof raw === "object" && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (typeof obj["goal"] === "string") return obj["goal"];
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Read the title field from spec/main.yaml. Returns "" on failure.
 */
export function readSpecTitle(planDir: string): string {
  try {
    const mainPath = path.join(planDir, "spec", "main.yaml");
    const content = fs.readFileSync(mainPath, "utf-8");
    const raw = yamlParse(content) as unknown;
    if (typeof raw === "object" && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (typeof obj["title"] === "string") return obj["title"];
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Read the constraints field from spec/main.yaml. Returns "" on failure.
 */
export function readSpecConstraints(planDir: string): string {
  try {
    const mainPath = path.join(planDir, "spec", "main.yaml");
    const content = fs.readFileSync(mainPath, "utf-8");
    const raw = yamlParse(content) as unknown;
    if (typeof raw === "object" && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (typeof obj["constraints"] === "string") return obj["constraints"];
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Filter a list of phase filenames to only those not yet completed.
 * Uses yaml.parse() on spec/main.yaml to read the `completed` field
 * on each phase entry — no hand-rolled regex.
 *
 * Returns `phaseFiles` unchanged on any error (fail-open so the caller
 * can still attempt all phases rather than silently skipping them).
 */
export function filterUncheckedSpecPhases(
  phaseFiles: string[],
  planDir: string,
): string[] {
  try {
    const mainPath = path.join(planDir, "spec", "main.yaml");
    const content = fs.readFileSync(mainPath, "utf-8");
    const raw = yamlParse(content) as unknown;
    const validation = validateMainSpec(raw);
    if (!validation.valid) {
      return phaseFiles;
    }
    const spec = raw as MainSpec;
    const completedSet = new Set(
      spec.phases.filter((p) => p.completed === true).map((p) => p.file),
    );
    return phaseFiles.filter((f) => !completedSet.has(f));
  } catch {
    return phaseFiles;
  }
}
