/**
 * YAML validation and heuristic repair for spec files.
 *
 * After the LLM writes a spec YAML, this module validates the parse and
 * attempts auto-correction of common LLM mistakes before execution begins.
 */

import { parse as yamlParse } from "yaml";
import { validateMainSpec, validatePhaseSpec } from "./spec-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YamlRepairResult {
  valid: boolean;
  content: string;
  corrections: string[];
  parseError?: string;
  schemaErrors?: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateAndRepairYaml(
  content: string,
  isMain: boolean,
): YamlRepairResult {
  // Try parsing as-is first
  const initial = tryParseAndValidate(content, isMain);
  if (initial.valid) {
    return { valid: true, content, corrections: [] };
  }

  // Apply heuristic fixes
  const [fixed, corrections] = applyHeuristicFixes(content);
  if (corrections.length === 0) {
    // No fixable patterns found — return original error
    return {
      valid: false,
      content,
      corrections: [],
      parseError: initial.parseError,
      schemaErrors: initial.schemaErrors,
    };
  }

  // Re-validate after fixes
  const repaired = tryParseAndValidate(fixed, isMain);
  if (repaired.valid) {
    return { valid: true, content: fixed, corrections };
  }

  // Fixes applied but still broken
  return {
    valid: false,
    content: fixed,
    corrections,
    parseError: repaired.parseError,
    schemaErrors: repaired.schemaErrors,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function tryParseAndValidate(
  content: string,
  isMain: boolean,
): { valid: boolean; parseError?: string; schemaErrors?: string[] } {
  let parsed: unknown;
  try {
    parsed = yamlParse(content);
  } catch (err) {
    return {
      valid: false,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }

  const validation = isMain
    ? validateMainSpec(parsed)
    : validatePhaseSpec(parsed);

  if (!validation.valid) {
    return { valid: false, schemaErrors: validation.errors };
  }

  return { valid: true };
}

function applyHeuristicFixes(content: string): [string, string[]] {
  let result = content;
  const corrections: string[] = [];

  // 1. Tab indentation → spaces
  const tabResult = fixTabIndentation(result);
  if (tabResult[1].length > 0) {
    result = tabResult[0];
    corrections.push(...tabResult[1]);
  }

  // 2. Unquoted values containing colons
  const colonResult = quoteUnquotedColonValues(result);
  if (colonResult[1].length > 0) {
    result = colonResult[0];
    corrections.push(...colonResult[1]);
  }

  return [result, corrections];
}

function fixTabIndentation(content: string): [string, string[]] {
  const corrections: string[] = [];
  const lines = content.split("\n");
  let fixCount = 0;

  const fixed = lines.map((line) => {
    const match = line.match(/^(\t+)/);
    if (!match) return line;
    fixCount++;
    return line.replace(/\t/g, "  ");
  });

  if (fixCount > 0) {
    corrections.push(`converted tabs to spaces on ${fixCount} line(s)`);
  }

  return [fixed.join("\n"), corrections];
}

function quoteUnquotedColonValues(content: string): [string, string[]] {
  const corrections: string[] = [];
  const lines = content.split("\n");

  const fixed = lines.map((line, idx) => {
    // Match: <indent><key>: <value> (not part of a block scalar or flow)
    const match = line.match(/^(\s*[\w][\w.\-/]*)\s*:\s+(.+)$/);
    if (!match) return line;

    const [, prefix, value] = match;
    const trimmed = value.trim();

    // Skip if already quoted
    if (/^["']/.test(trimmed)) return line;
    // Skip block scalar indicators
    if (/^[|>]/.test(trimmed)) return line;
    // Skip flow collections
    if (/^[{\[]/.test(trimmed)) return line;
    // Skip YAML booleans/nulls/numbers that are valid as-is
    if (/^(true|false|null|~|\d+\.?\d*)$/i.test(trimmed)) return line;
    // Only fix if the value contains a colon (the actual problem)
    if (!trimmed.includes(":")) return line;

    const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    corrections.push(`line ${idx + 1}: quoted value containing colon`);
    return `${prefix}: "${escaped}"`;
  });

  return [fixed.join("\n"), corrections];
}
