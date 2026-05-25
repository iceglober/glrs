/**
 * Plan enrichment for execution.
 *
 * This module reads the markdown plan files and generates `spec/*.yaml`
 * files from them. The spec IS the enriched artifact — one LLM pass per
 * file that reads the markdown + codebase and produces structured YAML
 * with enrichment context included:
 *   - mirror: references to similar existing files (pattern-match targets)
 *   - context: key function signatures, 10-20 lines of code for modified files
 *   - conventions: import style, export pattern, test framework, naming
 *
 * Per-file iteration: each plan file gets its own fresh session and its
 * own short-context prompt. This keeps each enrichment call's context
 * small and lets a SIGINT halfway through preserve the already-generated
 * spec files. Whole-plan single-pass enrichment is gone — the cost
 * savings of context-locality more than compensate for the per-file
 * session overhead.
 *
 * Idempotency (item 4.3): before opening any session, check whether
 * spec/ already exists with all items enriched (100% threshold). If so,
 * skip the entire pass. This saves an Opus call on re-runs against an
 * already-enriched plan.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { hasSpec, detectSpecPhases, parseSpecItems } from "./spec-parser.js";
import type { AutopilotLogger } from "./lib/logger.js";
import { childLogger } from "./lib/logger.js";
import type { AgentAdapter, AgentHandle } from "./adapter.js";
import type { SessionEventEmitter } from "./session-runner.js";
import { loadStrategy, extractFieldNames } from "./enrich-strategy.js";
import { resolveModel, type AdapterName } from "./model-resolver.js";
import { validatePlan } from "./plan-validator.js";

export interface EnrichmentRunConfig {
  retry?: boolean;
  max_retries?: number;
  stall_timeout?: number;
  strategy?: string;
  /** When true, skip all auto-recovery paths (stale-spec deletion, orphan decomposition). */
  resume?: boolean;
}

/**
 * The fraction of items that must declare all enrichment fields
 * (mirror/context/conventions/proof/proof_type) for a plan to be considered
 * "already enriched" — the idempotency check skips enrichment entirely above
 * this threshold. Item 4.3 and 5.2.
 */
/**
 * Spec enrichment requires 100% — every item must have all enrichment fields.
 * The old 0.8 threshold was a hedge for fuzzy markdown field detection.
 * With YAML, enrichment is binary: the field exists or it doesn't.
 */
export const ENRICHMENT_RATIO_THRESHOLD = 1.0;

// ---------------------------------------------------------------------------
// Freeform input decomposition
// ---------------------------------------------------------------------------

/**
 * Returns true when a file has no structured plan items — no checkboxes
 * (`- [ ]`) and no numbered headings (`### N.N`). Such files need
 * decomposition before the enrichment loop can process them.
 */
export function isFreeformFile(resolvedPath: string): boolean {
  try {
    if (fs.statSync(resolvedPath).isDirectory()) return false;
  } catch {
    return false;
  }
  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch {
    return false;
  }
  const checkboxItems = (content.match(/^- \[[ xX]\]/gm) ?? []).length;
  const headingItems = (content.match(/^###\s+\d+\.\d+\s/gm) ?? []).length;
  return Math.max(checkboxItems, headingItems) === 0;
}

// ---------------------------------------------------------------------------
// Orphaned phase reference detection
// ---------------------------------------------------------------------------

/**
 * Returns the list of phase markdown filenames referenced in `<planDir>/main.md`
 * that do NOT exist on disk. An empty list means the plan is internally consistent.
 *
 * Mirrors the two regex patterns used by `detectReferencedPhaseFiles` in
 * `plan-validator.ts:54-69` so detection is consistent with validation.
 *
 * Degrades safely: returns [] if main.md is missing or unreadable.
 */
export function findOrphanedPhaseReferences(planDir: string): string[] {
  const mainMdPath = path.join(planDir, "main.md");
  let content: string;
  try {
    content = fs.readFileSync(mainMdPath, "utf-8");
  } catch {
    return [];
  }

  const found = new Set<string>();
  // 1. Checkbox lines: `- [ ] file.md` or `- [x] [file.md](...)`
  const checkboxRe = /^- \[[ xX]\]\s+(?:\[)?([a-zA-Z0-9_-]+\.md)(?:\]\([^)]*\))?/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(content)) !== null) {
    found.add(match[1]);
  }
  // 2. Markdown link references: [file.md](./file.md)
  const linkRe = /\[([a-zA-Z0-9_-]+\.md)\]\(\.\//g;
  while ((match = linkRe.exec(content)) !== null) {
    found.add(match[1]);
  }

  const orphans: string[] = [];
  for (const filename of found) {
    if (!fs.existsSync(path.join(planDir, filename))) {
      orphans.push(filename);
    }
  }
  return orphans;
}

// ---------------------------------------------------------------------------
// Shared safety guard helper
// ---------------------------------------------------------------------------

/**
 * Returns true if any of the given phase YAML paths (relative to
 * `<planDir>/spec/`) has at least one item with `checked: true`.
 *
 * This is the canonical safety guard used by BOTH the pre-flight recovery
 * path (Bug A) and the in-enrichment orphan recovery path (Bug B) to
 * prevent auto-recovery from clobbering in-progress work.
 *
 * Mirrors the exact body of the original inline check at plan-enrichment.ts:520-524:
 *   const anyChecked = referencedPhases.some((p) => {
 *     const phasePath = path.join(resolvedPath, "spec", p);
 *     if (!fs.existsSync(phasePath)) return false;
 *     return parseSpecItems(phasePath).some((it) => it.checked);
 *   });
 * The `if (!fs.existsSync(phasePath)) return false` is critical — it handles
 * the case where the referenced phase YAML is itself missing.
 */
export function anyExistingPhaseHasCheckedItems(
  planDir: string,
  referencedPhases: string[],
): boolean {
  return referencedPhases.some((p) => {
    const phasePath = path.join(planDir, "spec", p);
    if (!fs.existsSync(phasePath)) return false;
    return parseSpecItems(phasePath).some((it) => it.checked);
  });
}

// ---------------------------------------------------------------------------
// Orphan recovery helpers
// ---------------------------------------------------------------------------

/**
 * Build the prompt for a one-shot orphan recovery decomposition session.
 * Unlike `buildDecompositionPrompt`, this variant is told that `main.md`
 * already exists and must NOT be rewritten — only the missing wave files.
 */
function buildOrphanRecoveryPrompt(
  cwd: string,
  planDir: string,
  mainMdContent: string,
  orphans: string[],
): string {
  const orphanList = orphans.map((f) => `- ${planDir}/${f}`).join("\n");
  return `You are completing a partially-decomposed multi-file plan.

The plan directory already has a \`main.md\` that references phase files which do not yet exist on disk. Your job is to write ONLY the missing phase files — do NOT rewrite or modify \`main.md\`.

## Plan directory
${planDir}

## Codebase root
${cwd}

## main.md content (DO NOT MODIFY)
\`\`\`markdown
${mainMdContent}
\`\`\`

## Missing phase files you must write
${orphanList}

## Instructions

1. Read the \`main.md\` content above to understand the plan structure.
2. Explore the codebase at ${cwd} to understand the project structure, test patterns, and file conventions.
3. For each missing phase file listed above, write a structured phase file with numbered items:

\`\`\`markdown
# Wave N: <Phase title>

### N.1 <Item title>
- intent: <What this item accomplishes>
- files:
    - <path/to/file.ts>
      Change: <What changes in this file>
- tests:
    - <path/to/test.ts>
- verify: <command to verify this item, e.g., "bun test path/to/test.ts">

### N.2 <Item title>
...
\`\`\`

4. Use the heading format \`### N.M\` (e.g., \`### 0.1\`, \`### 1.1\`) — this is the format the enrichment pipeline recognizes.
5. Keep items small and concrete. Each item should modify 1-3 files.
6. Write all missing phase files using the write/edit tool, then respond with "DECOMPOSITION_COMPLETE" when done.`;
}

/**
 * Attempt to recover orphaned phase references by running a one-shot
 * decomposition session that writes the missing wave_*.md source files.
 * Does NOT overwrite main.md.
 *
 * Returns true if ALL orphans now exist on disk after the session.
 * Returns false if the session errors, stalls, or any orphan is still missing.
 * On partial success (some but not all orphans written), leaves the partial
 * files in place (they may be useful to the user) and returns false.
 */
async function recoverOrphanedPhases(
  cwd: string,
  planDir: string,
  orphans: string[],
  log: ReturnType<typeof childLogger> | undefined,
  emitter: SessionEventEmitter | undefined,
  adapter: AgentAdapter,
  stallMs: number,
  config?: unknown,
): Promise<boolean> {
  let mainMdContent: string;
  try {
    mainMdContent = fs.readFileSync(path.join(planDir, "main.md"), "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg }, "recoverOrphanedPhases: failed to read main.md");
    return false;
  }

  const handle = await adapter.start({ cwd });
  let sessionId: string;
  try {
    const adapterName = adapter.name as AdapterName | undefined;
    const cfgObj = config as Record<string, unknown> | undefined;
    const models = cfgObj?.models as Record<string, unknown> | undefined;
    const enrichmentSpecifier = models?.enrichment as string | undefined;
    const resolvedModel = enrichmentSpecifier
      ? resolveModel(enrichmentSpecifier, adapterName ?? "opencode")
      : undefined;
    sessionId = await adapter.createSession(handle, {
      agentName: "prime",
      model: resolvedModel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg }, "recoverOrphanedPhases: createSession failed");
    await adapter.shutdown(handle);
    return false;
  }

  const prompt = buildOrphanRecoveryPrompt(cwd, planDir, mainMdContent, orphans);

  try {
    const result = await adapter.sendAndWait(handle, {
      sessionId,
      message: prompt,
      stallMs,
      onToolCall: (toolName) => {
        log?.debug({ toolName }, "Orphan recovery tool call");
      },
      onTextDelta: () => {},
      onCostUpdate: (cost, tokens) => {
        emitter?.emitEvent({
          type: "cost:update",
          timestamp: new Date().toISOString(),
          cumulativeCostUsd: cost,
          isEstimated: false,
          iteration: 0,
          tokensIn: tokens.input,
          tokensOut: tokens.output,
        });
      },
    });

    if (result.kind === "error" || result.kind === "stall") {
      const errMsg = result.kind === "error"
        ? ("message" in result ? (result as { message: string }).message : "session error")
        : "session stalled";
      log?.error({ err: errMsg }, "Orphan recovery session failed");
      return false;
    }

    // Check which orphans now exist on disk
    const stillMissing = orphans.filter(
      (f) => !fs.existsSync(path.join(planDir, f)),
    );

    if (stillMissing.length > 0) {
      log?.warn(
        { stillMissing },
        "Orphan recovery: decomposition ran but some wave files are still missing",
      );
      return false;
    }

    log?.info({ orphans }, "Orphan recovery: all missing wave files written");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error({ err: msg }, "Orphan recovery failed");
    return false;
  } finally {
    await adapter.shutdown(handle);
  }
}

function buildDecompositionPrompt(
  cwd: string,
  planDir: string,
  sourceFile: string,
  content: string,
): string {
  return `You are decomposing a freeform document into a structured multi-file plan for automated execution.

Read the freeform content below and explore the codebase at ${cwd} to understand the project structure. Then write a structured plan as multiple files in the directory: ${planDir}

## Required output files

### 1. main.md
Write \`${planDir}/main.md\` with this structure:

\`\`\`markdown
# <Title derived from the document>

## Goal
<1-3 sentence summary of what this work accomplishes>

## Constraints
<Technical constraints, conventions to follow, or boundaries on the work>

## Phases
- [ ] wave_0.md - <phase description>
- [ ] wave_1.md - <phase description>
(add more phases as needed)
\`\`\`

### 2. Phase files (wave_0.md, wave_1.md, etc.)
For each phase, write \`${planDir}/wave_N.md\` with numbered items:

\`\`\`markdown
# Wave N: <Phase title>

### N.1 <Item title>
- intent: <What this item accomplishes>
- files:
    - <path/to/file.ts>
      Change: <What changes in this file>
- tests:
    - <path/to/test.ts>
- verify: <command to verify this item, e.g., "bun test path/to/test.ts">

### N.2 <Item title>
...
\`\`\`

## Guidelines for decomposition

1. **Explore the codebase first.** Use file listing and reading tools to find:
   - The project's test framework and test patterns
   - Existing file naming conventions
   - Related modules that items will modify or reference
   - The package manager (bun/npm/pnpm/yarn) for verify commands

2. **Group items into phases by dependency.** Items in wave_0 should have no dependencies on later waves. Items within a wave should be independent or naturally sequential.

3. **Each item must be concrete and actionable.** Every item needs:
   - A clear \`intent:\` describing the change
   - Specific \`files:\` with real paths from the codebase
   - At least one test file in \`tests:\`
   - A runnable \`verify:\` command

4. **Keep items small.** Each item should be completable in a single focused session (1-3 files modified). Split large changes across multiple items.

5. **The heading format matters.** Use \`### N.M\` (e.g., \`### 0.1\`, \`### 0.2\`, \`### 1.1\`) — this is the format the enrichment pipeline recognizes.

## Source document

File: ${sourceFile}

\`\`\`markdown
${content}
\`\`\`

Write all the plan files using the write/edit tool, then respond with "DECOMPOSITION_COMPLETE" when done.`;
}

/**
 * Decompose a freeform file into a structured plan directory that the
 * standard enrichment pipeline can process. Spawns one LLM session.
 *
 * Returns the plan directory path on success, null on failure.
 * Idempotent: if `<stem>/main.md` already exists, returns immediately.
 */
async function decomposeFreeformPlan(
  cwd: string,
  resolvedPath: string,
  log: ReturnType<typeof childLogger> | undefined,
  emitter: SessionEventEmitter | undefined,
  adapter: AgentAdapter,
  stallMs: number,
  config?: unknown,
): Promise<string | null> {
  const parsed = path.parse(resolvedPath);
  const planDir = path.join(parsed.dir, parsed.name);
  const mainMdPath = path.join(planDir, "main.md");

  if (fs.existsSync(mainMdPath)) {
    log?.info({ planDir }, "Decomposed plan directory already exists — skipping");
    emitter?.emitEvent({
      type: "enrich:file:skip",
      timestamp: new Date().toISOString(),
      file: path.relative(cwd, resolvedPath),
      reason: "decomposed directory already exists",
    });
    return planDir;
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg }, "Failed to read freeform file");
    return null;
  }

  fs.mkdirSync(planDir, { recursive: true });

  emitter?.emitEvent({
    type: "enrich:file:start",
    timestamp: new Date().toISOString(),
    file: path.relative(cwd, resolvedPath),
  });

  const handle = await adapter.start({ cwd });
  let sessionId: string;
  try {
    const adapterName = adapter.name as AdapterName | undefined;
    const cfgObj = config as Record<string, unknown> | undefined;
    const models = cfgObj?.models as Record<string, unknown> | undefined;
    const enrichmentSpecifier = models?.enrichment as string | undefined;
    const resolvedModel = enrichmentSpecifier
      ? resolveModel(enrichmentSpecifier, adapterName ?? "opencode")
      : undefined;
    sessionId = await adapter.createSession(handle, {
      agentName: "prime",
      model: resolvedModel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg }, "createSession failed for decomposition");
    await adapter.shutdown(handle);
    return null;
  }

  const prompt = buildDecompositionPrompt(cwd, planDir, resolvedPath, content);

  try {
    const result = await adapter.sendAndWait(handle, {
      sessionId,
      message: prompt,
      stallMs,
      onToolCall: (toolName) => {
        log?.debug({ toolName }, "Decomposition tool call");
      },
      onTextDelta: () => {},
      onCostUpdate: (cost, tokens) => {
        emitter?.emitEvent({
          type: "cost:update",
          timestamp: new Date().toISOString(),
          cumulativeCostUsd: cost,
          isEstimated: false,
          iteration: 0,
          tokensIn: tokens.input,
          tokensOut: tokens.output,
        });
      },
    });

    if (result.kind === "error" || result.kind === "stall") {
      const errMsg = result.kind === "error"
        ? ("message" in result ? (result as { message: string }).message : "session error")
        : "session stalled";
      log?.error({ err: errMsg }, "Decomposition session failed");
      emitter?.emitEvent({
        type: "enrich:file:error",
        timestamp: new Date().toISOString(),
        file: path.relative(cwd, resolvedPath),
        error: `decomposition failed: ${errMsg}`,
      });
      return null;
    }

    const response = await adapter.getLastResponse(handle, sessionId);

    if (!fs.existsSync(mainMdPath)) {
      log?.warn("Decomposition completed but main.md was not written");
      emitter?.emitEvent({
        type: "enrich:file:error",
        timestamp: new Date().toISOString(),
        file: path.relative(cwd, resolvedPath),
        error: "decomposition completed but main.md was not written",
      });
      return null;
    }

    if (!response.includes("DECOMPOSITION_COMPLETE")) {
      log?.warn("Decomposition session did not emit completion sentinel");
    }

    log?.info({ planDir }, "Freeform file decomposed into structured plan");
    emitter?.emitEvent({
      type: "enrich:file:done",
      timestamp: new Date().toISOString(),
      file: path.relative(cwd, resolvedPath),
      toolCalls: 0,
    });

    return planDir;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error({ err: msg }, "Decomposition failed");
    return null;
  } finally {
    await adapter.shutdown(handle);
  }
}

/**
 * Compute the fraction of plan items across `planFiles` that already
 * have enrichment fields. Pure synchronous I/O — no server spawn — so
 * this is cheap to call before the enrichment pass.
 *
 * Heuristic: count items as "enriched" by taking the minimum across
 * all field-marker counts in the file. This is conservative
 * (an item missing any required field counts as 0) and forgiving on
 * parse errors (unreadable file → contributes 0 to both sides).
 *
 * Returns 0 if no items found across all files (avoids NaN division).
 */
export function computeEnrichmentRatio(
  planFiles: string[],
  fieldNames: string[] = ["mirror", "context", "conventions", "proof", "proof_type"],
): number {
  let total = 0;
  let enriched = 0;
  for (const f of planFiles) {
    let content: string;
    try {
      content = fs.readFileSync(f, "utf-8");
    } catch {
      // Unreadable file → contribute 0 to both sides (treat as 0 items).
      continue;
    }
    // Count items. Supports multiple plan formats:
    //   - `- [ ] 1.2 **Title**` or `- [ ] Title` (checkbox-based plans)
    //   - `### 1.2 title` (heading-based plans)
    // Heading-based plans often have checkboxes as sub-tasks within each
    // heading item. When headings exist, use heading count (those are the
    // enrichable items). Otherwise fall back to checkbox count.
    const checkboxItems = (content.match(/^- \[[ xX]\]/gm) ?? []).length;
    const headingItems = (content.match(/^###\s+\d+\.\d+\s/gm) ?? []).length;
    total += headingItems > 0 ? headingItems : checkboxItems;
    // Field markers — count occurrences of each field, then take the
    // min as a proxy for "items with all fields".
    const fieldCounts = fieldNames.map((field) => {
      const regex = new RegExp(`^\\s*-?\\s*${field}:`, "gm");
      return (content.match(regex) ?? []).length;
    });
    enriched += Math.min(...fieldCounts);
  }
  return total > 0 ? enriched / total : 0;
}

/**
 * Compute the enrichment ratio for a YAML spec plan directory.
 * Counts items with all enrichment fields across all phase files
 * referenced in spec/main.yaml. Strategy-aware: checks for the
 * specified fieldNames instead of hardcoded mirror/context/conventions.
 *
 * Returns 0 if no items found (avoids NaN division).
 */
export function computeSpecEnrichmentRatio(
  planDir: string,
  fieldNames: string[] = ["mirror", "context", "conventions", "proof", "proof_type"],
): number {
  if (!hasSpec(planDir)) return 0;
  const phaseFiles = detectSpecPhases(planDir);
  let total = 0;
  let enriched = 0;
  for (const phaseFile of phaseFiles) {
    const phasePath = path.join(planDir, "spec", phaseFile);
    let content: string;
    try {
      content = fs.readFileSync(phasePath, "utf-8");
    } catch {
      // Unreadable file → contribute 0 to both sides
      continue;
    }
    const raw = yamlParse(content) as unknown;
    const items = Array.isArray((raw as Record<string, unknown>)?.items)
      ? ((raw as Record<string, unknown>).items as Record<string, unknown>[])
      : [];
    total += items.length;
    for (const item of items) {
      const hasAllFields = fieldNames.every((field) => item[field]);
      if (hasAllFields) {
        enriched++;
      }
    }
  }
  return total > 0 ? enriched / total : 0;
}

/** Build the spec generation prompt for a plan file. */
function buildSpecGenerationPrompt(
  cwd: string,
  planDir: string,
  phaseFile: string,
  content: string,
  strategyName?: string,
  phaseSpecFiles?: string[],
): string {
  const isMain = phaseFile === "main.md";
  const specFileName = isMain
    ? "main.yaml"
    : phaseFile.replace(/\.md$/, ".yaml");
  const specPath = `spec/${specFileName}`;

  const phasesExample = phaseSpecFiles && phaseSpecFiles.length > 0
    ? phaseSpecFiles.map((f) => `  - file: ${f}\n    completed: false`).join("\n")
    : `  - file: wave_0.yaml\n    completed: false`;

  const schemaExample = isMain
    ? `\`\`\`yaml
# spec/main.yaml
title: "Plan title from H1"
goal: "Goal text"
constraints: "Constraints text"
phases:
${phasesExample}
\`\`\``
    : `\`\`\`yaml
# spec/${specFileName}
items:
  - id: "0.1"
    intent: "What this item does"
    checked: false
    files:
      - path: src/foo.ts
        isNew: false
        change: "What changes"
    tests:
      - "test/foo.test.ts"
    verify: "bun test test/foo.test.ts"
    mirror: "src/similar-file.ts"
    context: |
      // relevant code from the file being modified
    conventions: "ESM imports, named exports, bun:test"
    proof: "The acceptance proof should verify that the new function accepts valid inputs and rejects invalid ones"
    proof_type: "test"
\`\`\``;

  const phaseFileList = phaseSpecFiles && phaseSpecFiles.length > 0
    ? `\nThe phase spec files are (use these EXACT filenames in the phases array):\n${phaseSpecFiles.map((f) => `- ${f}`).join("\n")}\n`
    : "";

  const mainInstructions = `You are generating a YAML spec file from a markdown plan.

Read the markdown plan content below and write \`${specPath}\` (relative to the plan directory: ${planDir}) using the write/edit tool.

The output file should follow this schema:

${schemaExample}

Extract from the markdown:
- \`title\`: the H1 heading text
- \`goal\`: the Goal section text
- \`constraints\`: the Constraints section text (if present)
- \`phases\`: one entry per phase spec file, all with \`completed: false\`
${phaseFileList}
Here is the plan file to convert:

### ${phaseFile}
\`\`\`markdown
${content}
\`\`\`

Write the file \`${planDir}/${specPath}\` using the write/edit tool, then respond with "SPEC_COMPLETE" when done.`;

  if (isMain) {
    return mainInstructions;
  }

  const phaseTemplate = loadStrategy(cwd, strategyName ?? "default");
  const phaseInstructions = phaseTemplate
    .replaceAll("{{specPath}}", specPath)
    .replaceAll("{{planDir}}", planDir)
    .replaceAll("{{specFileName}}", specFileName)
    .replaceAll("{{phaseFile}}", phaseFile)
    .replaceAll("{{content}}", content);

  return phaseInstructions;
}

/**
 * Run a single enrichment pass, returning true if a stall occurred.
 * This is called from the retry loop in enrichPlanForFastModel.
 */
async function runEnrichmentPass(
  cwd: string,
  resolvedPath: string,
  planFiles: string[],
  isDir: boolean,
  fieldNames: string[],
  log: ReturnType<typeof childLogger> | undefined,
  emitter: SessionEventEmitter | undefined,
  adapter: AgentAdapter,
  handle: AgentHandle,
  stallMs: number,
  strategyName?: string,
  config?: unknown,
): Promise<boolean> {
  let stallOccurred = false;

  // Pre-compute spec filenames for phase files that have enrichable items.
  // Passed to the main.yaml prompt so the LLM uses correct phase references.
  const enrichablePhaseSpecFiles: string[] = [];
  for (const pf of planFiles) {
    const bn = path.basename(pf);
    if (bn === "main.md") continue;
    try {
      const c = fs.readFileSync(pf, "utf-8");
      const cb = (c.match(/^- \[[ xX]\]/gm) ?? []).length;
      const hd = (c.match(/^###\s+\d+\.\d+\s/gm) ?? []).length;
      if (Math.max(cb, hd) > 0) {
        enrichablePhaseSpecFiles.push(bn.replace(/\.md$/, ".yaml"));
      }
    } catch {
      // skip unreadable files
    }
  }

  for (const f of planFiles) {
    const rel = path.relative(cwd, f);
    const phaseFile = path.basename(f);

    // Determine the expected spec YAML path for this plan file
    const specFileName = phaseFile === "main.md"
      ? "main.yaml"
      : phaseFile.replace(/\.md$/, ".yaml");
    const specPath = isDir ? path.join(resolvedPath, "spec", specFileName) : null;

    // Per-file idempotency: skip if spec already exists and is enriched.
    // For phase files: skip if spec exists AND all items are fully enriched.
    // For main.md: skip if spec/main.yaml already exists — UNLESS the spec
    // is stale (references phase files that don't exist on disk) AND no
    // existing phase file has any checked items (safety guard).
    if (specPath && fs.existsSync(specPath)) {
      if (phaseFile === "main.md") {
        // Stale-spec detection: check whether every phase referenced in
        // spec/main.yaml actually exists on disk.
        const referencedPhases = detectSpecPhases(resolvedPath);
        const missingPhase = referencedPhases.some(
          (p) => !fs.existsSync(path.join(resolvedPath, "spec", p)),
        );

        if (missingPhase) {
          // Safety guard: if any existing phase file has checked items,
          // leave the spec alone (user has in-progress work).
          // Delegates to the shared helper so the guard logic is in one place.
          const anyChecked = anyExistingPhaseHasCheckedItems(resolvedPath, referencedPhases);

          if (anyChecked) {
            log?.info({ file: rel }, "Stale spec detected but phase has checked items — skipping (safety guard)");
            emitter?.emitEvent({
              type: "enrich:file:skip",
              timestamp: new Date().toISOString(),
              file: rel,
              reason: "stale spec but phase has checked items (safety guard)",
            });
            continue;
          }

          // No checked items — safe to re-enrich. Fall through to the
          // enrichment branch below (do NOT continue).
          log?.info({ file: rel }, "Stale spec detected — re-enriching main.md");
        } else {
          // All phase files present — normal idempotency skip.
          log?.info({ file: rel }, "Spec already exists — skipping");
          emitter?.emitEvent({
            type: "enrich:file:skip",
            timestamp: new Date().toISOString(),
            file: rel,
            reason: "spec already exists",
          });
          continue;
        }
      }
      // Phase file: skip if any item has checked:true — enrichment must
      // not overwrite in-progress work on resume.
      const phaseItems = parseSpecItems(specPath);
      if (phaseItems.some((it) => it.checked)) {
        log?.info({ file: rel }, "Phase has checked items — skipping re-enrichment");
        emitter?.emitEvent({
          type: "enrich:file:skip",
          timestamp: new Date().toISOString(),
          file: rel,
          reason: "phase has checked items (in-progress)",
        });
        continue;
      }
      const phaseTotal = phaseItems.length;
      const phaseEnriched = phaseItems.filter(
        (it) => {
          const item = it as unknown as Record<string, unknown>;
          return fieldNames.every((field) => item[field]);
        }
      ).length;
      const phaseRatio = phaseTotal > 0 ? phaseEnriched / phaseTotal : 0;
      if (phaseRatio >= ENRICHMENT_RATIO_THRESHOLD) {
        log?.info({ file: rel, ratio: phaseRatio }, "Phase spec already enriched — skipping");
        emitter?.emitEvent({
          type: "enrich:file:skip",
          timestamp: new Date().toISOString(),
          file: rel,
          reason: `already enriched (${Math.round(phaseRatio * 100)}%)`,
        });
        continue;
      }
    }

    // Read the markdown content
    let content: string;
    try {
      content = fs.readFileSync(f, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ file: rel, err: msg }, "File read failed — skipping");
      emitter?.emitEvent({
        type: "enrich:file:error",
        timestamp: new Date().toISOString(),
        file: rel,
        error: `read failed: ${msg}`,
      });
      continue;
    }

    // All plan files go through spec generation, including freeform files
    // with no pre-existing structure. The LLM decomposes freeform content
    // into structured items as part of spec generation.

    // Emit enrich:file:start event
    emitter?.emitEvent({
      type: "enrich:file:start",
      timestamp: new Date().toISOString(),
      file: rel,
    });

    // Each per-file session uses a fresh session ID so context stays
    // scoped to one file. Per-file stall timeout drops from 10 min
    // (single-pass legacy) to 5 min — smaller scope, smaller budget.
    let sessionId: string;
    try {
      const adapterName = adapter?.name as AdapterName | undefined;
      const cfgObj = config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const enrichmentSpecifier = models?.enrichment as string | undefined;
      const resolvedModel = enrichmentSpecifier
        ? resolveModel(enrichmentSpecifier, adapterName ?? "opencode")
        : undefined;
      sessionId = await adapter.createSession(handle, {
        agentName: "prime",
        model: resolvedModel,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ file: rel, err: msg }, "createSession failed — skipping");
      emitter?.emitEvent({
        type: "enrich:file:error",
        timestamp: new Date().toISOString(),
        file: rel,
        error: `createSession failed: ${msg}`,
      });
      continue;
    }

    const prompt = buildSpecGenerationPrompt(
      cwd, resolvedPath, phaseFile, content, strategyName,
      phaseFile === "main.md" ? enrichablePhaseSpecFiles : undefined,
    );

    let toolCalls = 0;
    let fileCost = 0;
    try {
      log?.info({ file: rel }, "Starting spec generation session");
      const sessionResult = await adapter.sendAndWait(handle, {
        sessionId,
        message: prompt,
        stallMs,
        onToolCall: (toolName, firstArg) => {
          toolCalls++;
          log?.debug({ file: rel, toolName, firstArg, toolCalls }, "Spec generation tool call");
          emitter?.emitEvent({
            type: "tool:call",
            timestamp: new Date().toISOString(),
            toolName,
            ...(firstArg ? { firstArg } : {}),
            iteration: 0,
          });
        },
        onTextDelta: () => {},
        onCostUpdate: (cost, tokens) => {
          fileCost = cost;
          emitter?.emitEvent({
            type: "cost:update",
            timestamp: new Date().toISOString(),
            cumulativeCostUsd: cost,
            isEstimated: false,
            iteration: 0,
            tokensIn: tokens.input,
            tokensOut: tokens.output,
          });
        },
      });

      // Check if the session errored before inspecting the response.
      // OpenCode's SSE event often carries only "session error" — we
      // scrape the server log for the real message (credential failure,
      // model not found, etc.)
      if (sessionResult.kind === "error") {
        const rawMsg = "message" in sessionResult ? (sessionResult as { message: string }).message : "unknown error";
        const errMsg = adapter.enhanceError ? await adapter.enhanceError(rawMsg) : rawMsg;
        log?.error({ file: rel, err: errMsg }, "Session errored");
        emitter?.emitEvent({
          type: "enrich:file:error",
          timestamp: new Date().toISOString(),
          file: rel,
          error: errMsg,
        });
        continue;
      }
      if (sessionResult.kind === "stall") {
        log?.error({ file: rel }, "Session stalled");
        stallOccurred = true;
        emitter?.emitEvent({
          type: "enrich:file:error",
          timestamp: new Date().toISOString(),
          file: rel,
          error: "session stalled",
        });
        continue;
      }

      const response = await adapter.getLastResponse(handle, sessionId);
      log?.debug({ file: rel, toolCalls, responseLength: response.length }, "Session response received");

      // Fetch cost + tokens after each enrichment file completes.
      // The SSE-based onCostUpdate often doesn't fire (message.updated
      // events arrive after session.idle settles the promise), so this
      // post-completion fetch is the reliable path for cost visibility.
      if (adapter.getSessionStats) {
        try {
          const stats = await adapter.getSessionStats(handle, sessionId);
          // Note: cost accumulation happens in outer function
          if (stats.tokensIn > 0 || stats.tokensOut > 0) {
            emitter?.emitEvent({
              type: "cost:update",
              timestamp: new Date().toISOString(),
              cumulativeCostUsd: stats.cost,
              isEstimated: false,
              iteration: 0,
              tokensIn: stats.tokensIn,
              tokensOut: stats.tokensOut,
            });
          }
        } catch {
          // Non-fatal — cost visibility is best-effort
        }
      }
      if (!response.includes("SPEC_COMPLETE")) {
        log?.warn({ file: rel, toolCalls }, "Spec generation session did not complete cleanly");
        emitter?.emitEvent({
          type: "enrich:file:error",
          timestamp: new Date().toISOString(),
          file: rel,
          error: "spec generation session did not complete cleanly",
        });
      } else if (specPath && !fs.existsSync(specPath)) {
        log?.warn({ file: rel, toolCalls }, "Spec generation session did not complete cleanly");
        emitter?.emitEvent({
          type: "enrich:file:error",
          timestamp: new Date().toISOString(),
          file: rel,
          error: `SPEC_COMPLETE received but spec/${specFileName} was not written`,
        });
      } else {
        log?.info({ file: rel, toolCalls }, "Spec generated successfully");
        emitter?.emitEvent({
          type: "enrich:file:done",
          timestamp: new Date().toISOString(),
          file: rel,
          toolCalls,
          ...(specPath ? { specFile: `spec/${specFileName}` } : {}),
        });
      }
    } catch (err) {
      // Per-file failure is non-fatal — log and move to the next file.
      // Partial spec generation is fine: completed files retain their
      // additions, the executor still benefits from those.
      const msg = err instanceof Error ? err.message : String(err);
      log?.error({ file: rel, err: msg, toolCalls }, "Spec generation failed — continuing");
      emitter?.emitEvent({
        type: "enrich:file:error",
        timestamp: new Date().toISOString(),
        file: rel,
        error: `spec generation failed: ${msg}`,
      });
    }
  }

  return stallOccurred;
}

// ---------------------------------------------------------------------------
// Post-enrichment validation + LLM-based repair loop
// ---------------------------------------------------------------------------

const MAX_REPAIR_ATTEMPTS = 3;

/**
 * Build a prompt that tells the LLM what went wrong and asks it to fix the
 * spec files. Includes the actual spec directory contents so the LLM can
 * see what files exist.
 */
function buildRepairPrompt(
  planDir: string,
  errors: Array<{ code: string; message: string; file?: string }>,
): string {
  const specDir = path.join(planDir, "spec");
  const actualFiles = fs.existsSync(specDir)
    ? fs.readdirSync(specDir).filter((f) => f.endsWith(".yaml")).sort()
    : [];

  const errorList = errors.map((e) => `- ${e.message}`).join("\n");
  const fileList = actualFiles.map((f) => `- spec/${f}`).join("\n");

  return `The spec files you generated failed validation. Fix the errors below.

## Validation errors
${errorList}

## Actual files in spec/ directory
${fileList}

## Instructions
- For "Phase file referenced in spec/main.yaml does not exist" errors: update spec/main.yaml's \`phases\` array so each entry's \`file:\` field matches an actual YAML file in the spec/ directory listed above. Do NOT rename the phase files — update main.yaml to reference the files that exist.
- For "Phase spec file exists on disk but is not referenced in spec/main.yaml" errors: add the missing file to spec/main.yaml's \`phases\` array with \`completed: false\`.
- For schema validation errors: fix the referenced spec file to match the expected YAML schema.
- For other errors: fix the referenced file.

Use the write/edit tool to make corrections, then respond with "REPAIR_COMPLETE".`;
}

/**
 * Run validation, and if it fails, send errors to the LLM for repair.
 * Loops until validation passes or the repair budget is exhausted.
 *
 * Returns the final validation report.
 */
async function validateAndRepairSpec(
  planDir: string,
  adapter: AgentAdapter,
  handle: AgentHandle,
  stallMs: number,
  log?: ReturnType<typeof childLogger>,
  emitter?: SessionEventEmitter,
  config?: unknown,
): Promise<{ errors: Array<{ code: string; message: string; file?: string }> }> {
  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const report = validatePlan(planDir);
    if (report.errors.length === 0) {
      log?.info("Post-enrichment validation passed");
      return report;
    }

    log?.warn(
      { attempt, errorCount: report.errors.length, errors: report.errors.map((e) => e.message) },
      "Post-enrichment validation failed — sending errors to LLM for repair",
    );

    emitter?.emitEvent({
      type: "enrich:repair:start",
      timestamp: new Date().toISOString(),
      attempt,
      errors: report.errors.map((e) => e.message),
    });

    const prompt = buildRepairPrompt(planDir, report.errors);

    let sessionId: string;
    try {
      const adapterName = adapter?.name as AdapterName | undefined;
      const cfgObj = config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const enrichmentSpecifier = models?.enrichment as string | undefined;
      const resolvedModel = enrichmentSpecifier
        ? resolveModel(enrichmentSpecifier, adapterName ?? "opencode")
        : undefined;
      sessionId = await adapter.createSession(handle, {
        agentName: "prime",
        model: resolvedModel,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ attempt, err: msg }, "Repair session creation failed");
      continue;
    }

    try {
      const result = await adapter.sendAndWait(handle, {
        sessionId,
        message: prompt,
        stallMs,
        onToolCall: (toolName, firstArg) => {
          log?.debug({ toolName, firstArg }, "Repair tool call");
          emitter?.emitEvent({
            type: "tool:call",
            timestamp: new Date().toISOString(),
            toolName,
            ...(firstArg ? { firstArg } : {}),
            iteration: 0,
          });
        },
        onTextDelta: () => {},
        onCostUpdate: (cost, tokens) => {
          emitter?.emitEvent({
            type: "cost:update",
            timestamp: new Date().toISOString(),
            cumulativeCostUsd: cost,
            isEstimated: false,
            iteration: 0,
            tokensIn: tokens.input,
            tokensOut: tokens.output,
          });
        },
      });

      if (result.kind === "error") {
        const rawMsg = "message" in result ? (result as { message: string }).message : "unknown";
        log?.warn({ attempt, err: rawMsg }, "Repair session errored");
      } else if (result.kind === "stall") {
        log?.warn({ attempt }, "Repair session stalled");
      } else {
        log?.info({ attempt }, "Repair session completed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ attempt, err: msg }, "Repair session failed");
    }

    emitter?.emitEvent({
      type: "enrich:repair:done",
      timestamp: new Date().toISOString(),
      attempt,
    });
  }

  // Final validation after all repair attempts
  const finalReport = validatePlan(planDir);
  if (finalReport.errors.length > 0) {
    log?.error(
      { errors: finalReport.errors.map((e) => e.message) },
      "Spec validation still failing after repair attempts",
    );
  }
  return finalReport;
}

/**
 * Enrich a plan for execution by generating spec/*.yaml files.
 *
 * For multi-file plans (directory with main.md), generates a spec YAML file
 * for each markdown plan file in its own session. For single-file plans,
 * generates a spec file for that file. Each per-file session is independent —
 * failures in one file are logged and skipped, the loop moves to the next.
 *
 * Idempotency: if spec/ already exists with all items fully enriched,
 * enriched, the entire pass is skipped. Per-file: if a spec YAML already
 * exists and is sufficiently enriched, that file is skipped.
 *
 * Retry: when enrichment stalls or errors, kills the server and retries the
 * entire pass. The per-file idempotency check skips already-enriched files,
 * so retries only pay for failures. Controlled by enrichmentConfig.retry
 * (default true) and enrichmentConfig.max_retries (default 3).
 */
export async function enrichPlan(
  cwd: string,
  planPath: string,
  logger?: AutopilotLogger,
  emitter?: SessionEventEmitter,
  adapter?: AgentAdapter,
  enrichmentConfig?: EnrichmentRunConfig,
  config?: unknown,
): Promise<string> {
  const log = logger ? childLogger(logger.root, "autopilot.enrichment") : undefined;
  const resolvedPath = path.resolve(cwd, planPath);
  const isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();

  // Freeform input: decompose into a structured plan directory, then enrich that.
  if (!isDir && isFreeformFile(resolvedPath)) {
    if (!adapter) {
      throw new Error("enrichPlanForFastModel: adapter is required for freeform decomposition");
    }
    log?.info({ file: resolvedPath }, "Freeform file detected — decomposing into structured plan");

    const stallMs = enrichmentConfig?.stall_timeout ?? (5 * 60 * 1000);
    const decomposedDir = await decomposeFreeformPlan(
      cwd,
      resolvedPath,
      log,
      emitter,
      adapter,
      stallMs,
      config,
    );

    if (decomposedDir) {
      log?.info({ planDir: decomposedDir }, "Decomposition complete — enriching structured plan");
      return enrichPlanForFastModel(
        cwd,
        decomposedDir,
        logger,
        emitter,
        adapter,
        enrichmentConfig,
        config,
      );
    }

    log?.warn("Freeform decomposition failed — falling through to single-file enrichment");
  }

  // Bug B: Orphaned phase reference detection and auto-recovery.
  // When main.md references wave_*.md files that don't exist on disk,
  // enrichment would generate a spec/main.yaml whose phases: entries point
  // at YAML files nothing will ever write — internal validation then correctly
  // rejects. Detect this BEFORE the enrichment ratio check so an
  // already-enriched-but-broken plan still gets repaired.
  if (isDir) {
    const orphans = findOrphanedPhaseReferences(resolvedPath);
    if (orphans.length > 0) {
      const isResume = enrichmentConfig?.resume === true;
      if (isResume) {
        // --resume: never auto-recover; let the user fix the plan manually.
        log?.info({ orphans }, "Orphaned phase references detected but --resume is set — skipping auto-recovery");
      } else {
        // Safety guard: don't auto-recover if any existing phase YAML has checked items.
        // Use both the orphan list AND any existing wave files as the phase set to check.
        const allPhaseYamls = orphans.map((f) => f.replace(/\.md$/, ".yaml"));
        const existingPhaseYamls = fs.existsSync(path.join(resolvedPath, "spec"))
          ? fs.readdirSync(path.join(resolvedPath, "spec")).filter((f) => f.endsWith(".yaml") && f !== "main.yaml")
          : [];
        const allPhasesToCheck = [...new Set([...allPhaseYamls, ...existingPhaseYamls])];
        const hasChecked = anyExistingPhaseHasCheckedItems(resolvedPath, allPhasesToCheck);

        if (hasChecked) {
          // In-progress work exists — throw a precise error rather than silently failing.
          throw new Error(
            `Plan inconsistency: main.md references phase files that don't exist: ${orphans.join(", ")}. ` +
            `Existing phase files have checked items — cannot auto-recover. ` +
            `Either create the missing files yourself, or remove the ## Phases section from main.md.`,
          );
        }

        // No checked items — attempt auto-decomposition.
        log?.info({ orphans }, "Orphaned phase references detected — attempting auto-decomposition");
        if (!adapter) {
          throw new Error(
            `Plan inconsistency: main.md references phase files that don't exist: ${orphans.join(", ")}. ` +
            `Either create them yourself, or remove the ## Phases section from main.md.`,
          );
        }

        const stallMs = enrichmentConfig?.stall_timeout ?? (5 * 60 * 1000);
        const recovered = await recoverOrphanedPhases(
          cwd,
          resolvedPath,
          orphans,
          log,
          emitter,
          adapter,
          stallMs,
          config,
        );

        if (!recovered) {
          // Check which orphans are still missing (partial decomposition state)
          const stillMissing = orphans.filter(
            (f) => !fs.existsSync(path.join(resolvedPath, f)),
          );
          const writtenCount = orphans.length - stillMissing.length;
          if (writtenCount > 0) {
            throw new Error(
              `Plan inconsistency: main.md references phase files that don't exist: ${stillMissing.join(", ")}. ` +
              `Decomposition wrote ${writtenCount} of ${orphans.length} expected wave files; the others are still missing. ` +
              `Either complete them yourself, or remove the ## Phases section from main.md.`,
            );
          }
          throw new Error(
            `Plan inconsistency: main.md references phase files that don't exist: ${orphans.join(", ")}. ` +
            `Either create them yourself, or remove the ## Phases section from main.md.`,
          );
        }

        log?.info({ orphans }, "Orphan auto-decomposition succeeded — continuing with enrichment");
      }
    }
  }

  // Collect the plan files to enrich
  let planFiles: string[];
  if (isDir) {
    const entries = fs.readdirSync(resolvedPath);
    planFiles = entries
      .filter((f) => f.endsWith(".md") && f !== "scope.md" && f !== "scope-seed.md")
      .sort((a, b) => {
        // main.md first, then natural numeric order (wave_0 < wave_1 < wave_10)
        if (a === "main.md") return -1;
        if (b === "main.md") return 1;
        const numA = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
        const numB = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
        return numA - numB;
      })
      .map((f) => path.join(resolvedPath, f));
  } else {
    planFiles = [resolvedPath];
  }

  // Emit enrich:start event
  emitter?.emitEvent({
    type: "enrich:start",
    timestamp: new Date().toISOString(),
    planPath: resolvedPath,
    fileCount: planFiles.length,
  });

  // Load strategy and extract field names for idempotency check.
  // Tries to load the strategy; falls back to defaults if not found.
  let fieldNames = ["mirror", "context", "conventions", "proof", "proof_type"];
  try {
    const strategy = loadStrategy(cwd, "default");
    fieldNames = extractFieldNames(strategy);
  } catch (err) {
    log?.warn({ err }, "Failed to load strategy — using defaults");
  }

  // Whole-plan idempotency check (item 4.3). Run BEFORE the server
  // spawn so an already-enriched plan costs nothing extra.
  // For YAML spec plans, use computeSpecEnrichmentRatio which reads
  // spec/main.yaml and the phase YAML files directly.
  const isYamlSpec = isDir && hasSpec(resolvedPath);
  const wholePlanRatio = isYamlSpec
    ? computeSpecEnrichmentRatio(resolvedPath, fieldNames)
    : computeEnrichmentRatio(planFiles, fieldNames);
  if (wholePlanRatio >= ENRICHMENT_RATIO_THRESHOLD) {
    log?.info({ ratio: wholePlanRatio }, "Plan already enriched — skipping");
    emitter?.emitEvent({
      type: "enrich:done",
      timestamp: new Date().toISOString(),
      filesProcessed: 0,
    });
    return resolvedPath;
  }

  // Ensure spec/ directory exists for YAML spec generation
  if (isDir) {
    fs.mkdirSync(path.join(resolvedPath, "spec"), { recursive: true });
  }

  // Snapshot existing phase completion states BEFORE enrichment.
  // Enrichment may regenerate spec/main.yaml with all phases set to
  // completed: false. We restore the original states after enrichment
  // so previously-completed phases aren't reset.
  const existingMainYaml = path.join(resolvedPath, "spec", "main.yaml");
  let savedCompletionStates: Map<string, boolean> | null = null;
  try {
    if (fs.existsSync(existingMainYaml)) {
      const content = fs.readFileSync(existingMainYaml, "utf-8");
      const raw = yamlParse(content) as Record<string, unknown>;
      if (raw && Array.isArray(raw.phases)) {
        savedCompletionStates = new Map();
        for (const phase of raw.phases as Array<{ file?: string; completed?: boolean }>) {
          if (phase.file && phase.completed === true) {
            savedCompletionStates.set(phase.file, true);
          }
        }
      }
    }
  } catch {
    // Can't read existing main.yaml — no states to preserve
  }

  // Resolve enrichment config with defaults
  const enableRetry = enrichmentConfig?.retry !== false;
  const maxRetries = enrichmentConfig?.max_retries ?? 3;
  const stallMs = enrichmentConfig?.stall_timeout ?? (5 * 60 * 1000);
  const strategyName = enrichmentConfig?.strategy;

  if (!adapter) {
    throw new Error("enrichPlanForFastModel: adapter is required");
  }

  log?.info({ planPath: resolvedPath, fileCount: planFiles.length, enableRetry, maxRetries }, "Starting enrichment");

  // Track cumulative cost across all enrichment sessions and attempts
  let enrichmentCumulativeCost = 0;

  // Retry loop: wraps the entire enrichment pass
  if (!enableRetry) {
    // Single attempt (legacy behavior when retry is disabled)
    log?.info("Enrichment retry disabled — single attempt only");
    const handle = await adapter.start({ cwd });
    log?.info({ agentId: handle.id }, "Agent ready for enrichment");
    try {
      const stallOccurred = await runEnrichmentPass(
        cwd,
        resolvedPath,
        planFiles,
        isDir,
        fieldNames,
        log,
        emitter,
        adapter,
        handle,
        stallMs,
        strategyName,
        config,
      );
      if (stallOccurred) {
        log?.warn("Enrichment stalled but retry is disabled");
      }
      if (isDir && hasSpec(resolvedPath)) {
        await validateAndRepairSpec(resolvedPath, adapter, handle, stallMs, log, emitter, config);
      }
    } finally {
      await adapter.shutdown(handle);
    }
  } else {
    // Retry loop (default behavior)
    let passSucceeded = false;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log?.info({ attempt, maxRetries }, "Starting enrichment attempt");
        const handle = await adapter.start({ cwd });
        log?.info({ agentId: handle.id, attempt }, "Agent ready for enrichment");

        try {
          const stallOccurred = await runEnrichmentPass(
            cwd,
            resolvedPath,
            planFiles,
            isDir,
            fieldNames,
            log,
            emitter,
            adapter,
            handle,
            stallMs,
            strategyName,
            config,
          );

          if (!stallOccurred) {
            log?.info({ attempt }, "Enrichment pass completed without stalling");

            if (isDir && hasSpec(resolvedPath)) {
              const report = await validateAndRepairSpec(
                resolvedPath, adapter, handle, stallMs, log, emitter, config,
              );
              if (report.errors.length > 0) {
                log?.warn(
                  { errorCount: report.errors.length },
                  "Post-enrichment validation has remaining errors — orchestrator will catch at execution time",
                );
              }
            }
            passSucceeded = true;
            break;
          }

          log?.warn({ attempt }, "Enrichment pass stalled, will retry");
        } finally {
          await adapter.shutdown(handle);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        log?.warn({ attempt, err: msg }, "Enrichment attempt failed");

        if (attempt === maxRetries) {
          throw new Error(`Enrichment exhausted ${maxRetries} retries: ${msg}`);
        }
      }
    }

    // If we exhausted all retries without success
    if (!passSucceeded) {
      const msg = lastError?.message ?? "unknown error";
      throw new Error(`Enrichment exhausted ${maxRetries} retries: ${msg}`);
    }
  }

  // Restore phase completion states that were saved before enrichment.
  // If enrichment regenerated spec/main.yaml, it set all phases to
  // completed: false. Restore the original completed: true states.
  if (savedCompletionStates && savedCompletionStates.size > 0) {
    try {
      const mainYamlPath = path.join(resolvedPath, "spec", "main.yaml");
      if (fs.existsSync(mainYamlPath)) {
        let content = fs.readFileSync(mainYamlPath, "utf-8");
        const raw = yamlParse(content) as Record<string, unknown>;
        if (raw && Array.isArray(raw.phases)) {
          let modified = false;
          for (const phase of raw.phases as Array<{ file?: string; completed?: boolean }>) {
            if (phase.file && savedCompletionStates.has(phase.file) && phase.completed !== true) {
              phase.completed = true;
              modified = true;
            }
          }
          if (modified) {
            fs.writeFileSync(mainYamlPath, yamlStringify(raw), "utf-8");
            log?.info({ restored: savedCompletionStates.size }, "Restored phase completion states after enrichment");
          }
        }
      }
    } catch (err) {
      log?.warn({ err }, "Failed to restore phase completion states — phases may need manual re-marking");
    }
  }

  // Emit enrich:done event
  emitter?.emitEvent({
    type: "enrich:done",
    timestamp: new Date().toISOString(),
    filesProcessed: planFiles.length,
  });

  return resolvedPath;
}

/** @deprecated Use `enrichPlan` instead. Kept for backward compatibility. */
export const enrichPlanForFastModel = enrichPlan;
