/**
 * Plan enrichment for fast-model execution.
 *
 * When --fast is used, this module reads the markdown plan files and
 * generates `spec/*.yaml` files from them. The spec IS the enriched
 * artifact — one LLM pass per file that reads the markdown + codebase
 * and produces structured YAML with enrichment context included:
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
 * skip the entire pass. This saves an Opus call on re-runs of `--fast`
 * against an already-enriched plan.
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

export interface EnrichmentRunConfig {
  retry?: boolean;
  max_retries?: number;
  stall_timeout?: number;
}

/**
 * The fraction of items that must declare all three enrichment fields
 * (mirror/context/conventions) for a plan to be considered "already
 * enriched" — the idempotency check skips enrichment entirely above
 * this threshold. Item 4.3.
 */
/**
 * Spec enrichment requires 100% — every item must have mirror/context/conventions.
 * The old 0.8 threshold was a hedge for fuzzy markdown field detection.
 * With YAML, enrichment is binary: the field exists or it doesn't.
 */
export const ENRICHMENT_RATIO_THRESHOLD = 1.0;

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
  fieldNames: string[] = ["mirror", "context", "conventions"],
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
  fieldNames: string[] = ["mirror", "context", "conventions"],
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
): string {
  const isMain = phaseFile === "main.md";
  const specFileName = isMain
    ? "main.yaml"
    : phaseFile.replace(/\.md$/, ".yaml");
  const specPath = `spec/${specFileName}`;

  const schemaExample = isMain
    ? `\`\`\`yaml
# spec/main.yaml
title: "Plan title from H1"
goal: "Goal text"
constraints: "Constraints text"
phases:
  - file: wave_0.yaml
    completed: false
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
\`\`\``;

  const mainInstructions = `You are generating a YAML spec file from a markdown plan.

Read the markdown plan content below and write \`${specPath}\` (relative to the plan directory: ${planDir}) using the write/edit tool.

The output file should follow this schema:

${schemaExample}

Extract from the markdown:
- \`title\`: the H1 heading text
- \`goal\`: the Goal section text
- \`constraints\`: the Constraints section text (if present)
- \`phases\`: one entry per phase file referenced (e.g., wave_0.md → wave_0.yaml), all with \`completed: false\`

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
): Promise<boolean> {
  let stallOccurred = false;

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
    // For main.md: skip if spec/main.yaml already exists.
    if (specPath && fs.existsSync(specPath)) {
      if (phaseFile === "main.md") {
        log?.info({ file: rel }, "Spec already exists — skipping");
        emitter?.emitEvent({
          type: "enrich:file:skip",
          timestamp: new Date().toISOString(),
          file: rel,
          reason: "spec already exists",
        });
        continue;
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
          const item = it as Record<string, unknown>;
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

    // Skip files with zero enrichable items (e.g., main.md with only
    // a table-of-contents). For main.md we always generate spec/main.yaml
    // regardless of item count — it captures title/goal/phases.
    if (phaseFile !== "main.md") {
      const checkboxItems = (content.match(/^- \[[ xX]\]/gm) ?? []).length;
      const headingItems = (content.match(/^###\s+\d+\.\d+\s/gm) ?? []).length;
      const itemCount = Math.max(checkboxItems, headingItems);
      if (itemCount === 0) {
        log?.info({ file: rel }, "No enrichable items — skipping");
        emitter?.emitEvent({
          type: "enrich:file:skip",
          timestamp: new Date().toISOString(),
          file: rel,
          reason: "no enrichable items",
        });
        continue;
      }
    }

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
      sessionId = await adapter.createSession(handle, {
        agentName: "prime",
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

    const prompt = buildSpecGenerationPrompt(cwd, resolvedPath, phaseFile, content, strategyName);

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

/**
 * Enrich a plan for fast-model execution by generating spec/*.yaml files.
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
export async function enrichPlanForFastModel(
  cwd: string,
  planPath: string,
  logger?: AutopilotLogger,
  emitter?: SessionEventEmitter,
  adapter?: AgentAdapter,
  enrichmentConfig?: EnrichmentRunConfig,
): Promise<void> {
  const log = logger ? childLogger(logger.root, "autopilot.enrichment") : undefined;
  const resolvedPath = path.resolve(cwd, planPath);
  const isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();

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
  let fieldNames = ["mirror", "context", "conventions"];
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
    return;
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
      );
      if (stallOccurred) {
        log?.warn("Enrichment stalled but retry is disabled");
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
          );

          if (!stallOccurred) {
            log?.info({ attempt }, "Enrichment pass completed without stalling");
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
}
