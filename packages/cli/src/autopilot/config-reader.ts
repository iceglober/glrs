/**
 * Config reader for autopilot configuration files.
 *
 * Reads `.glrs/autopilot.yaml` from a given repo root, parses with the yaml package,
 * validates against the AutopilotConfig schema, and rejects unknown keys with a clear
 * error message listing the bad fields.
 *
 * Returns `Partial<AutopilotConfig>` or `null` when the file doesn't exist.
 * Never throws on a missing file.
 *
 * Also provides plan-specific config resolution via `resolveConfig`, which deep-merges
 * plan-specific config over project-level config over defaults.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { AutopilotConfig } from "./autopilot-config.js";
import { DEFAULT_AUTOPILOT_CONFIG } from "./autopilot-config.js";

const ConfigPath = ".glrs/autopilot.yaml";

/** Schema for a single agent override (flexible, allows any properties) */
const AgentOverrideSchema = z.record(z.string(), z.unknown());

/** Schema for phase configuration (flexible, allows any properties) */
const PhaseConfigSchema = z.record(z.string(), z.unknown());

/** Schema for models configuration */
const ModelsSchema = z
  .object({
    enrichment: z.string().optional(),
    execution: z.string().optional(),
    debrief: z.string().optional(),
  })
  .strict();

/** Schema for OpenCode adapter configuration */
const OpencodeAdapterSchema = z
  .object({
    agents: z.record(z.string(), AgentOverrideSchema).optional(),
  })
  .strict();

/** Schema for Claude Code CLI adapter configuration */
const ClaudeCodeCliAdapterSchema = z
  .object({
    skip_permissions: z.boolean().optional(),
    allowed_tools: z.array(z.string()).optional(),
  })
  .strict();

/** Schema for adapters configuration */
const AdaptersSchema = z
  .object({
    opencode: OpencodeAdapterSchema.optional(),
    claude_code_cli: ClaudeCodeCliAdapterSchema.optional(),
  })
  .strict();

/** Schema for webhook event types */
const WebhookEventTypeSchema = z.enum([
  "iteration_complete",
  "phase_complete",
  "run_complete",
  "error",
  "struggle",
  "stall",
]);

/** Full schema for AutopilotConfig */
const AutopilotConfigSchema = z
  .object({
    adapter: z.enum(["opencode", "claude-code-cli"]).optional(),
    models: ModelsSchema.optional(),
    agents: z.record(z.string(), AgentOverrideSchema).optional(),
    enrichment: z.record(z.string(), z.unknown()).optional(),
    execution: z.record(z.string(), z.unknown()).optional(),
    hooks: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    phases: z.record(z.string(), PhaseConfigSchema).optional(),
    notify_url: z.string().optional(),
    notify_events: z.array(WebhookEventTypeSchema).optional(),
    adapters: AdaptersSchema.optional(),
  })
  .strict()
  .transform((val) => val as Partial<AutopilotConfig>);

/**
 * Reads and validates `.glrs/autopilot.yaml` from a given repo root.
 *
 * @param repoRoot The root directory of the repository
 * @returns `Partial<AutopilotConfig>` if the file exists and is valid, `null` if it doesn't exist
 * @throws Error if the file exists but is invalid (unknown keys or parsing errors)
 */
export function readAutopilotConfig(repoRoot: string): Partial<AutopilotConfig> | null {
  const configPath = path.join(repoRoot, ConfigPath);

  // Return null if the file doesn't exist (never throw on missing file)
  if (!fs.existsSync(configPath)) {
    return null;
  }

  // Read the file
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read ${ConfigPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(fileContent);
  } catch (err) {
    throw new Error(`Failed to parse ${ConfigPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // If the file is empty or null, return empty config
  if (parsed === null || parsed === undefined) {
    return {};
  }

  // Validate against schema and collect unknown keys
  try {
    return AutopilotConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Extract and format unknown key errors
      const unknownFields = err.issues
        .filter((issue) => issue.code === "unrecognized_keys")
        .flatMap((issue) => (issue.keys ? issue.keys : []));

      if (unknownFields.length > 0) {
        const fieldList = unknownFields.map((field) => `"${field}"`).join(", ");
        throw new Error(`Invalid ${ConfigPath}: unknown keys: ${fieldList}`);
      }

      // For other validation errors, provide a clear message
      const messages = err.issues.map((issue) => {
        const pathStr = issue.path.join(".");
        return `${pathStr || "root"}: ${issue.message}`;
      });
      throw new Error(`Invalid ${ConfigPath}:\n${messages.join("\n")}`);
    }
    throw err;
  }
}

/**
 * Derives the plan slug from a plan path.
 *
 * Given a path like `docs/plans/v2_2/` or `docs/plans/v2_2.md`, extracts the
 * slug (`v2_2`). If the path is empty or `.`, returns an empty string.
 *
 * @param planPath The plan path (directory or file)
 * @returns The derived slug, or empty string if no valid slug found
 */
function derivePlanSlug(planPath: string): string {
  if (!planPath || planPath === ".") {
    return "";
  }

  // Remove trailing slashes
  const normalized = planPath.replace(/\/$/, "");

  // Get the last component
  const basename = path.basename(normalized);

  // If it's a markdown file, remove the extension
  if (basename.endsWith(".md")) {
    return basename.slice(0, -3);
  }

  return basename;
}

/**
 * Deep merges objects recursively, with later objects overriding earlier ones.
 * For arrays and scalars, the last value wins (no array merging).
 *
 * @param objects Variable number of objects to merge
 * @returns A new merged object
 */
function deepMerge(...objects: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      continue;
    }

    for (const key in obj) {
      const srcValue = (obj as Record<string, unknown>)[key];

      // If source is an object (but not array), recursively merge
      if (
        srcValue &&
        typeof srcValue === "object" &&
        !Array.isArray(srcValue) &&
        !(srcValue instanceof Date)
      ) {
        const targetValue = result[key];
        if (
          targetValue &&
          typeof targetValue === "object" &&
          !Array.isArray(targetValue) &&
          !(targetValue instanceof Date)
        ) {
          // Both are objects; recurse
          result[key] = deepMerge(
            targetValue as Record<string, unknown>,
            srcValue as Record<string, unknown>,
          );
        } else {
          // Target is not an object; use source
          result[key] = srcValue;
        }
      } else {
        // Source is a scalar, array, or null; use it directly
        result[key] = srcValue;
      }
    }
  }

  return result;
}

/**
 * Resolves autopilot configuration with plan-specific overrides.
 *
 * Performs a three-layer merge:
 *   1. DEFAULT_AUTOPILOT_CONFIG (lowest priority)
 *   2. Project-level config (`.glrs/autopilot.yaml`)
 *   3. Plan-specific config (`.glrs/plans/<slug>/autopilot.yaml`)
 *
 * The plan slug is derived from the planPath (basename, or filename minus `.md`).
 * If the planPath is `.` or empty, only the project-level config is used (no plan layer).
 *
 * Field-level merging: overrides apply to individual keys, not entire blocks.
 * For example, setting only `models.execution` in the plan replaces just that field,
 * not the entire `models` block.
 *
 * @param repoRoot The root directory of the repository
 * @param planPath The plan path (directory or file), or `.` for no plan layer
 * @returns A fully-populated `AutopilotConfig` with all defaults applied
 */
export function resolveConfig(repoRoot: string, planPath: string = "."): AutopilotConfig {
  // Read the project-level config
  const projectConfig = readAutopilotConfig(repoRoot) ?? {};

  // Derive the slug and read plan-specific config
  const slug = derivePlanSlug(planPath);
  let planConfig: Partial<AutopilotConfig> = {};

  if (slug) {
    const planConfigPath = path.join(repoRoot, ".glrs", "plans", slug, "autopilot.yaml");
    if (fs.existsSync(planConfigPath)) {
      // Read from the plan directory
      let fileContent: string;
      try {
        fileContent = fs.readFileSync(planConfigPath, "utf8");
      } catch (err) {
        throw new Error(`Failed to read plan config at ${planConfigPath}: ${err instanceof Error ? err.message : String(err)}`);
      }

      let parsed: unknown;
      try {
        parsed = parseYaml(fileContent);
      } catch (err) {
        throw new Error(`Failed to parse plan config at ${planConfigPath}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (parsed !== null && parsed !== undefined) {
        try {
          planConfig = AutopilotConfigSchema.parse(parsed);
        } catch (err) {
          if (err instanceof z.ZodError) {
            const unknownFields = err.issues
              .filter((issue) => issue.code === "unrecognized_keys")
              .flatMap((issue) => (issue.keys ? issue.keys : []));

            if (unknownFields.length > 0) {
              const fieldList = unknownFields.map((field) => `"${field}"`).join(", ");
              throw new Error(`Invalid plan config at ${planConfigPath}: unknown keys: ${fieldList}`);
            }

            const messages = err.issues.map((issue) => {
              const pathStr = issue.path.join(".");
              return `${pathStr || "root"}: ${issue.message}`;
            });
            throw new Error(`Invalid plan config at ${planConfigPath}:\n${messages.join("\n")}`);
          }
          throw err;
        }
      }
    }
  }

  // Deep merge in order: defaults → project → plan
  const merged = deepMerge(
    DEFAULT_AUTOPILOT_CONFIG as Record<string, unknown>,
    projectConfig as Record<string, unknown>,
    planConfig as Record<string, unknown>,
  );

  return merged as AutopilotConfig;
}
