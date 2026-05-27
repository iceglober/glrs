/**
 * Plan-validator module for the autopilot.
 *
 * Validates the structural integrity of a YAML spec plan before execution:
 *   - spec/main.yaml exists and is valid
 *   - every phase file referenced in spec/main.yaml exists on disk
 *   - every phase file validates against the spec schema
 *
 * Errors block execution. Warnings are informational.
 *
 * Pure function: only reads `fs` synchronously. Never throws — degrades
 * to `{ errors: [], warnings: [...] }` on parse failure so callers can
 * always render the report.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { hasSpec, detectSpecPhases } from "./spec-parser.js";
import { validateMainSpec, validatePhaseSpec } from "./spec-schema.js";
import { parse as yamlParse } from "yaml";

export interface ValidationError {
  code: string;
  message: string;
  file?: string;
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
 * Validate the plan at `planPath`. Returns a `ValidationReport`.
 *
 * For directory plans, validates spec/main.yaml + each referenced phase.
 * For single-file plans (not yet enriched), returns a "requires enrichment" error.
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
    errors.push({
      code: "requires-enrichment",
      message: "Single-file plan requires enrichment before execution",
      file: planPath,
    });
    return { errors, warnings };
  }

  if (!hasSpec(planPath)) {
    errors.push({
      code: "missing-spec",
      message: "Plan directory has no spec/ — run enrichment first",
    });
    return { errors, warnings };
  }

  // Validate spec/main.yaml and phase files
  {
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

    // Check for phase spec files on disk that main.yaml doesn't reference.
    // An empty phases array when spec files exist means the LLM dropped them.
    const specDir = path.join(planPath, "spec");
    try {
      const onDisk = fs.readdirSync(specDir)
        .filter((f) => f.endsWith(".yaml") && f !== "main.yaml");
      const referencedSet = new Set(phaseFiles);
      for (const file of onDisk) {
        if (!referencedSet.has(file)) {
          errors.push({
            code: "unreferenced-spec-phase-file",
            message: `Phase spec file exists on disk but is not referenced in spec/main.yaml: ${file}`,
            file,
          });
        }
      }
    } catch {
      // spec dir unreadable — already handled above
    }

    // Check for phase markdown files in the plan directory that have no
    // corresponding spec. If the plan dir has enrichable phase .md files
    // but main.yaml lists 0 phases, the LLM dropped them.
    try {
      const planMdFiles = fs.readdirSync(planPath)
        .filter((f) =>
          f.endsWith(".md") &&
          f !== "main.md" &&
          f !== "scope.md" &&
          f !== "scope-seed.md" &&
          !f.startsWith("_"),
        );
      if (planMdFiles.length > 0 && phaseFiles.length === 0) {
        errors.push({
          code: "empty-phases-with-plan-files",
          message: `spec/main.yaml has 0 phases but the plan directory contains ${planMdFiles.length} phase markdown file(s): ${planMdFiles.join(", ")}. The phases array must reference each phase's spec file.`,
        });
      }
    } catch {
      // plan dir unreadable — already handled above
    }

    return { errors, warnings };
  }
}
