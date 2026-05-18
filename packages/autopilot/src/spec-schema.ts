/**
 * TypeScript interfaces and runtime validators for YAML spec files.
 *
 * Two spec file types:
 *   - MainSpec: spec/main.yaml — plan title, goal, phases list
 *   - PhaseSpec: spec/<phase>.yaml — items array with all item fields
 *
 * Validators return { valid, errors } rather than throwing so callers
 * can surface clear error messages instead of silent data loss.
 */

// ---------------------------------------------------------------------------
// TypeScript interfaces (YAML structure)
// ---------------------------------------------------------------------------

export interface SpecFileEntry {
  path: string;
  isNew: boolean;
  change: string;
}

export interface SpecItem {
  id: string;
  intent: string;
  checked: boolean;
  files?: SpecFileEntry[];
  tests?: string[];
  verify?: string;
  /** Enrichment fields (added by plan-enrichment pass) */
  mirror?: string;
  context?: string;
  conventions?: string;
  proof?: string;
  proof_type?: string;
}

export interface SpecPhaseRef {
  file: string;
  completed: boolean;
}

export interface MainSpec {
  title?: string;
  goal?: string;
  constraints?: string;
  phases: SpecPhaseRef[];
}

export interface PhaseSpec {
  items: SpecItem[];
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Runtime validators
// ---------------------------------------------------------------------------

/**
 * Validate a parsed main spec object. Returns structured errors rather
 * than throwing so callers can surface clear messages.
 */
export function validateMainSpec(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: ["main spec must be an object"] };
  }

  const obj = raw as Record<string, unknown>;

  if (!("phases" in obj)) {
    errors.push("main spec missing required field: phases");
  } else if (!Array.isArray(obj["phases"])) {
    errors.push("main spec field 'phases' must be an array");
  } else {
    const phases = obj["phases"] as unknown[];
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      if (typeof phase !== "object" || phase === null) {
        errors.push(`phases[${i}] must be an object`);
        continue;
      }
      const p = phase as Record<string, unknown>;
      if (!("file" in p) || typeof p["file"] !== "string") {
        errors.push(`phases[${i}] missing required field: file`);
      }
      if (!("completed" in p) || typeof p["completed"] !== "boolean") {
        errors.push(`phases[${i}] missing required field: completed (boolean)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a parsed phase spec object. Returns structured errors rather
 * than throwing so callers can surface clear messages.
 */
export function validatePhaseSpec(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: ["phase spec must be an object"] };
  }

  const obj = raw as Record<string, unknown>;

  if (!("items" in obj)) {
    errors.push("phase spec missing required field: items");
    return { valid: false, errors };
  }

  if (!Array.isArray(obj["items"])) {
    errors.push("phase spec field 'items' must be an array");
    return { valid: false, errors };
  }

  const items = obj["items"] as unknown[];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== "object" || item === null) {
      errors.push(`items[${i}] must be an object`);
      continue;
    }
    const it = item as Record<string, unknown>;
    if (!("id" in it) || typeof it["id"] !== "string" || !it["id"]) {
      errors.push(`items[${i}] missing required field: id`);
    }
    if (!("intent" in it) || typeof it["intent"] !== "string" || !it["intent"]) {
      errors.push(`items[${i}] missing required field: intent`);
    }
  }

  return { valid: errors.length === 0, errors };
}
