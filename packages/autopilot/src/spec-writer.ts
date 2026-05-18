/**
 * YAML spec writer for the autopilot engine.
 *
 * Reads existing YAML spec files, applies targeted mutations (mark item
 * checked, mark phase completed, write enrichment fields), and writes
 * back using yaml.stringify() to preserve structure.
 *
 * All functions are synchronous and never throw — failures are silently
 * swallowed so the orchestrator can continue even if a write fails.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

/**
 * Atomically write `content` to `target` by writing to a tmp file in the
 * same directory and then renaming. Guarantees the file is either fully
 * old or fully new — a crash mid-write cannot leave a truncated file.
 */
function atomicWriteFileSync(target: string, content: string): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, target);
}

/**
 * Mark a specific item as checked in a phase YAML file.
 *
 * @param planDir - The plan directory (parent of spec/)
 * @param phaseFile - The phase filename (e.g., "wave_0.yaml")
 * @param itemId - The item id to mark checked
 */
export function markItemChecked(
  planDir: string,
  phaseFile: string,
  itemId: string,
): void {
  const phasePath = path.join(planDir, "spec", phaseFile);
  try {
    const content = fs.readFileSync(phasePath, "utf-8");
    const raw = yamlParse(content) as unknown;
    if (typeof raw !== "object" || raw === null) return;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj["items"])) return;

    const items = obj["items"] as Array<Record<string, unknown>>;
    let found = false;
    for (const item of items) {
      if (item["id"] === itemId) {
        item["checked"] = true;
        found = true;
        break;
      }
    }
    if (!found) return;

    atomicWriteFileSync(phasePath, yamlStringify(raw));
  } catch {
    // Silent failure — orchestrator continues
  }
}

/**
 * Mark a phase as completed in spec/main.yaml.
 *
 * @param planDir - The plan directory (parent of spec/)
 * @param phaseFile - The phase filename to mark completed (e.g., "wave_0.yaml")
 */
export function markPhaseCompleted(planDir: string, phaseFile: string): void {
  const mainPath = path.join(planDir, "spec", "main.yaml");
  try {
    const content = fs.readFileSync(mainPath, "utf-8");
    const raw = yamlParse(content) as unknown;
    if (typeof raw !== "object" || raw === null) return;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj["phases"])) return;

    const phases = obj["phases"] as Array<Record<string, unknown>>;
    let found = false;
    for (const phase of phases) {
      if (phase["file"] === phaseFile) {
        phase["completed"] = true;
        found = true;
        break;
      }
    }
    if (!found) return;

    atomicWriteFileSync(mainPath, yamlStringify(raw));
  } catch {
    // Silent failure
  }
}

/**
 * Write enrichment fields (mirror, context, conventions) to a specific
 * item in a phase YAML file. Merges with existing fields — existing
 * values are overwritten only for the fields provided.
 *
 * @param planDir - The plan directory (parent of spec/)
 * @param phaseFile - The phase filename (e.g., "wave_0.yaml")
 * @param itemId - The item id to update
 * @param fields - Enrichment fields to write (partial — only provided keys are set)
 */
export function writeEnrichmentFields(
  planDir: string,
  phaseFile: string,
  itemId: string,
  fields: {
    mirror?: string;
    context?: string;
    conventions?: string;
  },
): void {
  const phasePath = path.join(planDir, "spec", phaseFile);
  try {
    const content = fs.readFileSync(phasePath, "utf-8");
    const raw = yamlParse(content) as unknown;
    if (typeof raw !== "object" || raw === null) return;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj["items"])) return;

    const items = obj["items"] as Array<Record<string, unknown>>;
    let found = false;
    for (const item of items) {
      if (item["id"] === itemId) {
        if (fields.mirror !== undefined) item["mirror"] = fields.mirror;
        if (fields.context !== undefined) item["context"] = fields.context;
        if (fields.conventions !== undefined)
          item["conventions"] = fields.conventions;
        found = true;
        break;
      }
    }
    if (!found) return;

    atomicWriteFileSync(phasePath, yamlStringify(raw));
  } catch {
    // Silent failure
  }
}
