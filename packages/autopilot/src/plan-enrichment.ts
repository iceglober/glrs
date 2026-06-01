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

import { AGENTS } from "@glrs-dev/agent-core";
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
// Plan directory normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a plan path into a directory. If the input is already a
 * directory, return it. If it's a file, create a sibling directory
 * named after the file stem and return that.
 */
function ensurePlanDir(resolvedPath: string, isDir: boolean): string {
  if (isDir) return resolvedPath;
  const parsed = path.parse(resolvedPath);
  const planDir = path.join(parsed.dir, parsed.name);
  fs.mkdirSync(planDir, { recursive: true });
  return planDir;
}

// ---------------------------------------------------------------------------
// Unified enrichment prompt for single-file input
// ---------------------------------------------------------------------------

/**
 * Build a prompt that tells the LLM to read a plan document, explore the
 * codebase, and write spec/main.yaml + spec/wave_N.yaml directly. This
 * collapses the old two-step decomposition→enrichment flow into one pass.
 */
function buildUnifiedEnrichmentPrompt(
  cwd: string,
  planDir: string,
  sourceFile: string,
  content: string,
  strategyName?: string,
): string {
  let enrichmentFields = `    mirror: "src/similar-file.ts"
    context: |
      // relevant code snippets from modified files (10-20 lines)
    conventions: "ESM imports, named exports, bun:test"
    proof: "Acceptance proof description"
    proof_type: "test"`;

  try {
    const strategy = loadStrategy(cwd, strategyName ?? "default");
    const fields = extractFieldNames(strategy);
    if (fields.length > 0) {
      enrichmentFields = fields
        .map((f) => `    ${f}: "<${f} value>"`)
        .join("\n");
    }
  } catch {
    // Use defaults above
  }

  return `You are translating a plan document into structured YAML spec files for automated execution.

Read the plan content below, explore the codebase at ${cwd} to understand the project structure, then write YAML spec files in: ${planDir}/spec/

## Required output files

### 1. spec/main.yaml
\`\`\`yaml
title: "Plan title"
goal: "What this work accomplishes"
constraints: "Technical constraints or boundaries"
phases:
  - file: wave_0.yaml
    completed: false
  - file: wave_1.yaml
    completed: false
\`\`\`

### 2. Phase spec files (spec/wave_0.yaml, spec/wave_1.yaml, etc.)
\`\`\`yaml
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
${enrichmentFields}
\`\`\`

## Guidelines

1. **Explore the codebase first.** Use file listing and reading tools to understand:
   - Project structure, test framework, file conventions
   - Existing patterns in files being modified
   - The package manager for verify commands

2. **Group items into phases by dependency.** Wave 0 items have no deps on later waves. Items within a wave should be independent.

3. **Every item must have ALL enrichment fields.** Read existing files to populate mirror/context/conventions accurately.

4. **Keep items small.** Each should modify 1-3 files.

5. **Use real paths.** Every \`files:\` entry and \`tests:\` entry must use real paths from the codebase.

6. Ensure the \`phases:\` array in spec/main.yaml references the exact filenames of every phase spec file you write.

## Source document

File: ${sourceFile}

\`\`\`
${content}
\`\`\`

Write all spec files using the write/edit tool, then respond with "SPEC_COMPLETE" when done.`;
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
 * This is called from the retry loop in enrichPlan.
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
          const anyChecked = referencedPhases.some((p) => {
            const pp = path.join(resolvedPath, "spec", p);
            if (!fs.existsSync(pp)) return false;
            return parseSpecItems(pp).some((it) => it.checked);
          });

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
        agentName: AGENTS.PRIME,
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

  // List markdown plan files so the LLM knows what phases should exist
  const planMdFiles = fs.readdirSync(planDir)
    .filter((f) =>
      f.endsWith(".md") &&
      f !== "main.md" &&
      f !== "scope.md" &&
      f !== "scope-seed.md" &&
      !f.startsWith("_"),
    )
    .sort();

  const errorList = errors.map((e) => `- ${e.message}`).join("\n");
  const fileList = actualFiles.map((f) => `- spec/${f}`).join("\n");
  const mdFileList = planMdFiles.map((f) => `- ${f}`).join("\n");

  return `The spec files you generated failed validation. Fix the errors below.

## Validation errors
${errorList}

## Actual files in spec/ directory
${fileList}

## Phase markdown files in plan directory
${mdFileList || "(none)"}

## Instructions
- For "Phase file referenced in spec/main.yaml does not exist" errors: update spec/main.yaml's \`phases\` array so each entry's \`file:\` field matches an actual YAML file in the spec/ directory listed above. Do NOT rename the phase files — update main.yaml to reference the files that exist.
- For "Phase spec file exists on disk but is not referenced in spec/main.yaml" errors: add the missing file to spec/main.yaml's \`phases\` array with \`completed: false\`.
- For "spec/main.yaml has 0 phases but the plan directory contains phase markdown files" errors: the phases array is empty but should list one spec file per phase markdown file. Each markdown file \`wave-foo.md\` should have a corresponding spec entry \`file: wave-foo.yaml\`. Add all expected phases to main.yaml with \`completed: false\`, and generate any missing spec/<phase>.yaml files.
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
        agentName: AGENTS.PRIME,
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
 * Any input — a single file or a directory — goes through one flow:
 *   1. Normalize to a plan directory (file → sibling dir)
 *   2. Idempotency check via computeSpecEnrichmentRatio
 *   3. Single-file input → unified enrichment (one LLM pass → all spec files)
 *      Directory input → per-file enrichment (each .md → one spec YAML)
 *   4. validateAndRepairSpec → LLM self-repair loop (up to 3 attempts)
 *   5. Final deterministic validatePlan → throw if invalid
 *   6. Return the plan directory path
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

  // Step 1: normalize to a plan directory
  const planDir = ensurePlanDir(resolvedPath, isDir);
  const isSingleFileInput = !isDir;

  if (isSingleFileInput) {
    log?.info({ file: resolvedPath, planDir }, "Single-file input — will run unified enrichment");
  }

  // Load strategy and extract field names for idempotency check.
  let fieldNames = ["mirror", "context", "conventions", "proof", "proof_type"];
  try {
    const strategy = loadStrategy(cwd, "default");
    fieldNames = extractFieldNames(strategy);
  } catch {
    // Use defaults
  }

  // Step 2: idempotency check — skip if already fully enriched
  if (hasSpec(planDir)) {
    const wholePlanRatio = computeSpecEnrichmentRatio(planDir, fieldNames);
    if (wholePlanRatio >= ENRICHMENT_RATIO_THRESHOLD) {
      log?.info({ ratio: wholePlanRatio }, "Plan already enriched — skipping");
      emitter?.emitEvent({
        type: "enrich:done",
        timestamp: new Date().toISOString(),
        filesProcessed: 0,
      });
      return planDir;
    }
  }

  if (!adapter) {
    throw new Error("enrichPlan: adapter is required");
  }

  // Ensure spec/ directory exists
  fs.mkdirSync(path.join(planDir, "spec"), { recursive: true });

  // Snapshot existing phase completion states before enrichment.
  // Enrichment may regenerate spec/main.yaml with all phases set to
  // completed: false. We restore the original states afterward.
  const existingMainYaml = path.join(planDir, "spec", "main.yaml");
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

  const enableRetry = enrichmentConfig?.retry !== false;
  const maxRetries = enrichmentConfig?.max_retries ?? 3;
  const stallMs = enrichmentConfig?.stall_timeout ?? (5 * 60 * 1000);
  const strategyName = enrichmentConfig?.strategy;

  // Emit enrich:start event
  emitter?.emitEvent({
    type: "enrich:start",
    timestamp: new Date().toISOString(),
    planPath: planDir,
    fileCount: isSingleFileInput ? 1 : 0,
  });

  // Step 3: run enrichment
  if (isSingleFileInput) {
    // Unified enrichment: one LLM session writes all spec files directly
    await runUnifiedEnrichment(
      cwd, planDir, resolvedPath, log, emitter, adapter,
      stallMs, maxRetries, enableRetry, strategyName, config,
    );
  } else {
    // Directory input: per-file enrichment (each .md → one spec YAML)
    const planFiles = collectPlanFiles(planDir);

    log?.info({ planDir, fileCount: planFiles.length, enableRetry, maxRetries }, "Starting per-file enrichment");

    await runPerFileEnrichment(
      cwd, planDir, planFiles, fieldNames, log, emitter, adapter,
      stallMs, maxRetries, enableRetry, strategyName, config,
    );
  }

  // Step 4 + 5: validate and repair, then final deterministic validation
  // validateAndRepairSpec runs the LLM repair loop; the final validatePlan
  // is a pure deterministic check that throws on failure.
  if (hasSpec(planDir)) {
    const handle = await adapter.start({ cwd });
    try {
      await validateAndRepairSpec(planDir, adapter, handle, stallMs, log, emitter, config);
    } finally {
      await adapter.shutdown(handle);
    }

    const finalReport = validatePlan(planDir);
    if (finalReport.errors.length > 0) {
      const errMsgs = finalReport.errors.map((e) => e.message).join("; ");
      throw new Error(`Enrichment produced invalid spec: ${errMsgs}`);
    }
  }

  // Restore phase completion states that were saved before enrichment.
  if (savedCompletionStates && savedCompletionStates.size > 0) {
    try {
      const mainYamlPath = path.join(planDir, "spec", "main.yaml");
      if (fs.existsSync(mainYamlPath)) {
        const content = fs.readFileSync(mainYamlPath, "utf-8");
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

  emitter?.emitEvent({
    type: "enrich:done",
    timestamp: new Date().toISOString(),
    filesProcessed: isSingleFileInput ? 1 : collectPlanFiles(planDir).length,
  });

  return planDir;
}

// ---------------------------------------------------------------------------
// Enrichment execution helpers
// ---------------------------------------------------------------------------

function collectPlanFiles(planDir: string): string[] {
  const entries = fs.readdirSync(planDir);
  return entries
    .filter((f) => f.endsWith(".md") && f !== "scope.md" && f !== "scope-seed.md")
    .sort((a, b) => {
      if (a === "main.md") return -1;
      if (b === "main.md") return 1;
      const numA = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
      return numA - numB;
    })
    .map((f) => path.join(planDir, f));
}

/**
 * Run unified enrichment for a single-file plan input. One LLM session
 * reads the source file, explores the codebase, and writes all spec
 * files (spec/main.yaml + spec/wave_N.yaml) directly.
 */
async function runUnifiedEnrichment(
  cwd: string,
  planDir: string,
  sourceFile: string,
  log: ReturnType<typeof childLogger> | undefined,
  emitter: SessionEventEmitter | undefined,
  adapter: AgentAdapter,
  stallMs: number,
  maxRetries: number,
  enableRetry: boolean,
  strategyName?: string,
  config?: unknown,
): Promise<void> {
  let content: string;
  try {
    content = fs.readFileSync(sourceFile, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read plan file: ${msg}`);
  }

  const prompt = buildUnifiedEnrichmentPrompt(cwd, planDir, sourceFile, content, strategyName);
  const effectiveRetries = enableRetry ? maxRetries : 1;

  for (let attempt = 1; attempt <= effectiveRetries; attempt++) {
    const handle = await adapter.start({ cwd });
    try {
      log?.info({ attempt, maxRetries: effectiveRetries }, "Starting unified enrichment");

      const adapterName = adapter.name as AdapterName | undefined;
      const cfgObj = config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const enrichmentSpecifier = models?.enrichment as string | undefined;
      const resolvedModel = enrichmentSpecifier
        ? resolveModel(enrichmentSpecifier, adapterName ?? "opencode")
        : undefined;

      const sessionId = await adapter.createSession(handle, {
        agentName: AGENTS.PRIME,
        model: resolvedModel,
      });

      emitter?.emitEvent({
        type: "enrich:file:start",
        timestamp: new Date().toISOString(),
        file: path.relative(cwd, sourceFile),
      });

      const result = await adapter.sendAndWait(handle, {
        sessionId,
        message: prompt,
        stallMs,
        onToolCall: (toolName) => {
          log?.debug({ toolName }, "Unified enrichment tool call");
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
        const errMsg = adapter.enhanceError ? await adapter.enhanceError(rawMsg) : rawMsg;
        log?.error({ attempt, err: errMsg }, "Unified enrichment session errored");
        if (attempt === effectiveRetries) {
          throw new Error(`Unified enrichment failed after ${effectiveRetries} attempts: ${errMsg}`);
        }
        continue;
      }

      if (result.kind === "stall") {
        log?.warn({ attempt }, "Unified enrichment session stalled");
        if (attempt === effectiveRetries) {
          throw new Error(`Unified enrichment stalled after ${effectiveRetries} attempts`);
        }
        continue;
      }

      const response = await adapter.getLastResponse(handle, sessionId);
      if (!response.includes("SPEC_COMPLETE")) {
        log?.warn("Unified enrichment did not emit SPEC_COMPLETE sentinel");
      }

      emitter?.emitEvent({
        type: "enrich:file:done",
        timestamp: new Date().toISOString(),
        file: path.relative(cwd, sourceFile),
        toolCalls: 0,
      });

      log?.info({ planDir }, "Unified enrichment completed");
      return;
    } finally {
      await adapter.shutdown(handle);
    }
  }
}

/**
 * Run per-file enrichment for a directory plan. Each .md file gets its
 * own session producing one spec YAML file. Wraps the existing
 * runEnrichmentPass with the retry loop.
 */
async function runPerFileEnrichment(
  cwd: string,
  planDir: string,
  planFiles: string[],
  fieldNames: string[],
  log: ReturnType<typeof childLogger> | undefined,
  emitter: SessionEventEmitter | undefined,
  adapter: AgentAdapter,
  stallMs: number,
  maxRetries: number,
  enableRetry: boolean,
  strategyName?: string,
  config?: unknown,
): Promise<void> {
  const effectiveRetries = enableRetry ? maxRetries : 1;

  for (let attempt = 1; attempt <= effectiveRetries; attempt++) {
    const handle = await adapter.start({ cwd });
    try {
      log?.info({ attempt, maxRetries: effectiveRetries }, "Starting per-file enrichment pass");

      const stallOccurred = await runEnrichmentPass(
        cwd, planDir, planFiles, true, fieldNames,
        log, emitter, adapter, handle, stallMs, strategyName, config,
      );

      if (!stallOccurred) {
        log?.info({ attempt }, "Per-file enrichment pass completed");
        return;
      }

      log?.warn({ attempt }, "Per-file enrichment pass stalled, will retry");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ attempt, err: msg }, "Per-file enrichment attempt failed");
      if (attempt === effectiveRetries) {
        throw new Error(`Enrichment exhausted ${effectiveRetries} retries: ${msg}`);
      }
    } finally {
      await adapter.shutdown(handle);
    }
  }

  throw new Error(`Enrichment exhausted ${effectiveRetries} retries`);
}
