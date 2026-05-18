/**
 * Plan-validator module for the autopilot (item 4.5).
 *
 * Validates the structural integrity of a plan before execution starts:
 *   - main.md exists for directory plans
 *   - every phase file referenced in main.md exists on disk
 *   - every phase file has at least one item with `intent:`
 *   - soft warnings for items missing `files:`, `tests:`, or `verify:`
 *
 * Errors block execution (the orchestrator returns early). Warnings are
 * informational — the run continues so the agent can still patch the
 * plan in-flight.
 *
 * Pure function: only reads `fs` synchronously. Never throws — degrades
 * to `{ errors: [], warnings: [...] }` on parse failure so callers can
 * always render the report.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseItems } from "./plan-parser.js";
import { hasSpec, detectSpecPhases } from "./spec-parser.js";
import { validateMainSpec, validatePhaseSpec } from "./spec-schema.js";
import { parse as yamlParse } from "yaml";

export interface ValidationError {
  /** Stable machine-readable code (e.g., "missing-main", "missing-phase-file"). */
  code: string;
  /** Human-readable description of what's wrong. */
  message: string;
  /** Plan file path (relative to plan dir or absolute) when applicable. */
  file?: string;
  /** Plan-state item id (e.g., "4.1") when applicable. */
  itemId?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  file?: string;
  itemId?: string;
}

export interface ValidationReport {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Detect phase-file references inside main.md.
 * Mirrors the `detectPhaseFiles` logic used at runtime in
 * `loop-session.ts` so validation reflects what the runner will see.
 */
function detectReferencedPhaseFiles(mainContent: string): Set<string> {
  const found = new Set<string>();
  // 1. Checkbox lines: `- [ ] file.md` or `- [x] [file.md](...)`
  const checkboxRe =
    /^- \[[ xX]\]\s+(?:\[)?([a-zA-Z0-9_-]+\.md)(?:\]\([^)]*\))?/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(mainContent)) !== null) {
    found.add(match[1]);
  }
  // 2. Markdown link references in tables or prose: [file.md](./file.md)
  const linkRe = /\[([a-zA-Z0-9_-]+\.md)\]\(\.\//g;
  while ((match = linkRe.exec(mainContent)) !== null) {
    found.add(match[1]);
  }
  return found;
}

/**
 * Validate the plan at `planPath`. Returns a `ValidationReport`.
 *
 * For directory plans (path is a directory), checks main.md + each
 * referenced phase file. For single-file plans, only the soft per-item
 * checks apply.
 *
 * Never throws — any I/O failure becomes a warning rather than a thrown
 * exception so callers can degrade gracefully.
 */
export function validatePlan(planPath: string): ValidationReport {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(planPath);
  } catch {
    errors.push({
      code: "missing-plan",
      message: `Plan path does not exist: ${planPath}`,
    });
    return { errors, warnings };
  }

  if (!stat.isDirectory()) {
    // Single-file plan — run only the per-item soft checks.
    try {
      const content = fs.readFileSync(planPath, "utf-8");
      checkItemsSoft(content, planPath, warnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push({
        code: "plan-read-failed",
        message: `Plan file unreadable: ${msg}`,
        file: planPath,
      });
    }
    return { errors, warnings };
  }

  // YAML spec path: validate spec/main.yaml and phase files when spec/ exists
  if (hasSpec(planPath)) {
    const mainSpecPath = path.join(planPath, "spec", "main.yaml");
    try {
      const mainContent = fs.readFileSync(mainSpecPath, "utf-8");
      const rawMain = yamlParse(mainContent) as unknown;
      const mainValidation = validateMainSpec(rawMain);
      if (!mainValidation.valid) {
        for (const msg of mainValidation.errors) {
          errors.push({
            code: "invalid-spec-main",
            message: `spec/main.yaml: ${msg}`,
            file: mainSpecPath,
          });
        }
        return { errors, warnings };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({
        code: "invalid-spec-main",
        message: `spec/main.yaml unreadable: ${msg}`,
        file: mainSpecPath,
      });
      return { errors, warnings };
    }

    // Validate each phase file referenced in spec/main.yaml
    const phaseFiles = detectSpecPhases(planPath);
    for (const phaseFile of phaseFiles) {
      const phasePath = path.join(planPath, "spec", phaseFile);
      if (!fs.existsSync(phasePath)) {
        errors.push({
          code: "missing-spec-phase-file",
          message: `Phase file referenced in spec/main.yaml does not exist: ${phaseFile}`,
          file: phaseFile,
        });
        continue;
      }
      try {
        const phaseContent = fs.readFileSync(phasePath, "utf-8");
        const rawPhase = yamlParse(phaseContent) as unknown;
        const phaseValidation = validatePhaseSpec(rawPhase);
        if (!phaseValidation.valid) {
          for (const msg of phaseValidation.errors) {
            errors.push({
              code: "invalid-spec-phase",
              message: `spec/${phaseFile}: ${msg}`,
              file: phaseFile,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          code: "spec-phase-read-failed",
          message: `spec/${phaseFile} unreadable: ${msg}`,
          file: phaseFile,
        });
      }
    }

    return { errors, warnings };
  }

  // Directory plan: main.md required.
  const mainPath = path.join(planPath, "main.md");
  if (!fs.existsSync(mainPath)) {
    errors.push({
      code: "missing-main",
      message: "Directory plan must contain main.md",
      file: mainPath,
    });
    return { errors, warnings };
  }

  let mainContent: string;
  try {
    mainContent = fs.readFileSync(mainPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({
      code: "main-read-failed",
      message: `main.md unreadable: ${msg}`,
      file: mainPath,
    });
    return { errors, warnings };
  }

  const referencedPhases = detectReferencedPhaseFiles(mainContent);

  // Every referenced phase file must exist on disk.
  for (const phaseFile of referencedPhases) {
    const phasePath = path.join(planPath, phaseFile);
    if (!fs.existsSync(phasePath)) {
      errors.push({
        code: "missing-phase-file",
        message: `Phase file referenced in main.md does not exist: ${phaseFile}`,
        file: phaseFile,
      });
    }
  }

  // Every phase file on disk must have at least one item with `intent:`,
  // AND each item is checked for soft warnings.
  let phaseEntries: string[] = [];
  try {
    phaseEntries = fs
      .readdirSync(planPath)
      .filter(
        (f) =>
          f.endsWith(".md") &&
          f !== "main.md" &&
          f !== "scope.md" &&
          f !== "scope-seed.md",
      );
  } catch {
    // Already covered by the stat check above; safe to swallow.
  }

  for (const phaseFile of phaseEntries) {
    const phasePath = path.join(planPath, phaseFile);
    let content: string;
    try {
      content = fs.readFileSync(phasePath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push({
        code: "phase-read-failed",
        message: `Phase file unreadable: ${msg}`,
        file: phaseFile,
      });
      continue;
    }

    const items = parseItems(content);
    const withIntent = items.filter((it) => it.intent && it.intent.trim());
    if (items.length > 0 && withIntent.length === 0) {
      errors.push({
        code: "no-intent-in-phase",
        message: `Phase file has items but none declare an intent: ${phaseFile}`,
        file: phaseFile,
      });
    }

    checkItemsSoft(content, phaseFile, warnings);
  }

  return { errors, warnings };
}

/**
 * Soft per-item checks: warn when an item is missing `files:`, `tests:`,
 * or a `verify:` command. These don't block execution — the agent can
 * (and often does) flesh them out as it works.
 */
function checkItemsSoft(
  content: string,
  file: string,
  warnings: ValidationWarning[],
): void {
  const items = parseItems(content);
  for (const item of items) {
    if (item.files.length === 0) {
      warnings.push({
        code: "missing-files",
        message: `Item ${item.id} has no files: list`,
        file,
        itemId: item.id,
      });
    }
    if (item.tests.length === 0) {
      warnings.push({
        code: "missing-tests",
        message: `Item ${item.id} has no tests: list`,
        file,
        itemId: item.id,
      });
    }
    if (!item.verify || !item.verify.trim()) {
      warnings.push({
        code: "missing-verify",
        message: `Item ${item.id} has no verify: command`,
        file,
        itemId: item.id,
      });
    }
  }
}
