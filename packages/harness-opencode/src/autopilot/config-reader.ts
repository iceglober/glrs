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
 * Validates that custom agent prompt files exist for the given config.
 *
 * Checks `config.adapters?.opencode?.agents` and for each entry with a `prompt`
 * field: (1) rejects absolute paths with a distinct error, (2) verifies the file
 * exists relative to repoRoot, collecting all missing paths.
 *
 * @param config The resolved autopilot configuration
 * @param repoRoot The root directory of the repository
 * @throws Error if absolute paths are found or files are missing
 */
function validateAgentPromptFiles(config: Partial<AutopilotConfig>, repoRoot: string): void {
  const agents = config.adapters?.opencode?.agents;
  if (!agents || typeof agents !== "object") {
    return;
  }

  const absolutePaths: string[] = [];
  const missingFiles: string[] = [];

  for (const [agentName, overrides] of Object.entries(agents)) {
    if (!overrides || typeof overrides !== "object") continue;
    const promptValue = (overrides as Record<string, unknown>).prompt;
    if (typeof promptValue !== "string") continue;

    // Check for absolute paths
    if (path.isAbsolute(promptValue)) {
      absolutePaths.push(promptValue);
      continue;
    }

    // Check if file exists
    const resolvedPath = path.join(repoRoot, promptValue);
    if (!fs.existsSync(resolvedPath)) {
      missingFiles.push(resolvedPath);
    }
  }

  // Throw distinct errors for each problem type
  if (absolutePaths.length > 0) {
    const paths = absolutePaths.map((p) => `"${p}"`).join(", ");
    throw new Error(
      `Config error: absolute paths not allowed for agent prompts: ${paths}. ` +
      `Paths must be relative to repo root.`,
    );
  }

  if (missingFiles.length > 0) {
    const paths = missingFiles.map((p) => `"${p}"`).join(", ");
    throw new Error(
      `Config error: agent prompt files not found: ${paths}`,
    );
  }
}

/**
 * Resolves phase-level config overrides by deep-merging phase-specific config
 * over the base config.
 *
 * When `baseConfig.phases?.[phaseName]` exists, deep-merges it over the base
 * (phase wins on conflict). The phase name should be the filename without
 * extension (e.g., `wave_0` not `wave_0.md` or `wave_0.yaml`).
 *
 * If the phase is not found in the config, returns the base config unchanged.
 *
 * @param baseConfig The resolved base configuration (project + plan + defaults)
 * @param phaseName The phase name without extension (e.g., `wave_0`)
 * @returns A config object with phase-specific overrides merged in
 */
export function resolvePhaseConfig(
  baseConfig: AutopilotConfig,
  phaseName: string,
): AutopilotConfig {
  const phaseOverride = baseConfig.phases?.[phaseName];
  if (!phaseOverride) {
    return baseConfig;
  }

  const merged = deepMerge(
    baseConfig as Record<string, unknown>,
    phaseOverride as Record<string, unknown>,
  );

  return merged as AutopilotConfig;
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
 * Also validates that custom agent prompt files exist (for OpenCode adapter).
 *
 * @param repoRoot The root directory of the repository
 * @param planPath The plan path (directory or file), or `.` for no plan layer
 * @returns A fully-populated `AutopilotConfig` with all defaults applied
 * @throws Error if agent prompt files are missing or have invalid paths
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

  const config = merged as AutopilotConfig;

  // Validate agent prompt files exist
  validateAgentPromptFiles(config, repoRoot);

  return config;
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

// Allowed values for enum fields
export const ALLOWED_ADAPTERS = ["opencode", "claude-code-cli"] as const;
export const ALLOWED_VERIFY_STRATEGIES = ["after_phase", "after_item", "skip"] as const;
export const ALLOWED_EXECUTION_ORDERS = ["sequential", "parallel"] as const;
export const ALLOWED_ROLLBACK_STRATEGIES = ["soft", "off"] as const;
export const ALLOWED_CHANGESET_BUMPS = ["patch", "minor", "major"] as const;
const PINO_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

/**
 * Validates the fully-merged config (project + plan + phase + CLI).
 * Collects all validation errors at once rather than short-circuiting on the first error.
 *
 * @param config The resolved config to validate
 * @returns {ok: true} if valid, {ok: false; errors: [...]} if invalid
 */
export function validateConfig(config: AutopilotConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate adapter
  if (config.adapter !== undefined) {
    if (!ALLOWED_ADAPTERS.includes(config.adapter as any)) {
      errors.push({
        path: "adapter",
        message: `must be one of: ${ALLOWED_ADAPTERS.join(", ")} (got "${config.adapter}")`,
      });
    }
  }

  // Validate verify strategy
  if (config.verify !== undefined) {
    if (!ALLOWED_VERIFY_STRATEGIES.includes(config.verify as any)) {
      errors.push({
        path: "verify",
        message: `must be one of: ${ALLOWED_VERIFY_STRATEGIES.join(", ")} (got "${config.verify}")`,
      });
    }
  }

  // Validate verify_timeout is a positive integer
  if (config.verify_timeout !== undefined) {
    if (!Number.isInteger(config.verify_timeout) || config.verify_timeout <= 0) {
      errors.push({
        path: "verify_timeout",
        message: `must be a positive integer (got ${config.verify_timeout})`,
      });
    }
  }

  // Validate max_iterations_per_phase is a positive integer
  if (config.max_iterations_per_phase !== undefined) {
    if (!Number.isInteger(config.max_iterations_per_phase) || config.max_iterations_per_phase <= 0) {
      errors.push({
        path: "max_iterations_per_phase",
        message: `must be a positive integer (got ${config.max_iterations_per_phase})`,
      });
    }
  }

  // Validate max_iterations_per_item is a positive integer
  if (config.max_iterations_per_item !== undefined) {
    if (!Number.isInteger(config.max_iterations_per_item) || config.max_iterations_per_item <= 0) {
      errors.push({
        path: "max_iterations_per_item",
        message: `must be a positive integer (got ${config.max_iterations_per_item})`,
      });
    }
  }

  // Validate stall_timeout is a positive integer
  if (config.stall_timeout !== undefined) {
    if (!Number.isInteger(config.stall_timeout) || config.stall_timeout <= 0) {
      errors.push({
        path: "stall_timeout",
        message: `must be a positive integer (got ${config.stall_timeout})`,
      });
    }
  }

  // Validate execution_order
  if (config.execution_order !== undefined) {
    if (!ALLOWED_EXECUTION_ORDERS.includes(config.execution_order as any)) {
      errors.push({
        path: "execution_order",
        message: `must be one of: ${ALLOWED_EXECUTION_ORDERS.join(", ")} (got "${config.execution_order}")`,
      });
    }
  }

  // Validate parallel_lanes is a positive integer
  if (config.parallel_lanes !== undefined) {
    if (!Number.isInteger(config.parallel_lanes) || config.parallel_lanes <= 0) {
      errors.push({
        path: "parallel_lanes",
        message: `must be a positive integer (got ${config.parallel_lanes})`,
      });
    }
  }

  // Validate rollback_on_failure
  if (config.rollback_on_failure !== undefined) {
    if (!ALLOWED_ROLLBACK_STRATEGIES.includes(config.rollback_on_failure as any)) {
      errors.push({
        path: "rollback_on_failure",
        message: `must be one of: ${ALLOWED_ROLLBACK_STRATEGIES.join(", ")} (got "${config.rollback_on_failure}")`,
      });
    }
  }

  // Validate changeset_bump
  if (config.changeset_bump !== undefined) {
    if (!ALLOWED_CHANGESET_BUMPS.includes(config.changeset_bump as any)) {
      errors.push({
        path: "changeset_bump",
        message: `must be one of: ${ALLOWED_CHANGESET_BUMPS.join(", ")} (got "${config.changeset_bump}")`,
      });
    }
  }

  // Validate log_level is a valid pino level
  if (config.log_level !== undefined) {
    if (!PINO_LEVELS.includes(config.log_level as any)) {
      errors.push({
        path: "log_level",
        message: `must be a valid pino level (${PINO_LEVELS.join(", ")}) (got "${config.log_level}")`,
      });
    }
  }

  // Validate hooks are non-empty strings
  if (config.hooks) {
    for (const [hookName, hookValue] of Object.entries(config.hooks)) {
      if (Array.isArray(hookValue)) {
        for (let i = 0; i < hookValue.length; i++) {
          if (typeof hookValue[i] !== "string" || hookValue[i].trim() === "") {
            errors.push({
              path: `hooks.${hookName}[${i}]`,
              message: "hook command must be a non-empty string",
            });
          }
        }
      } else if (typeof hookValue === "string") {
        if (hookValue.trim() === "") {
          errors.push({
            path: `hooks.${hookName}`,
            message: "hook command must be a non-empty string",
          });
        }
      }
    }
  }

  // Recursively validate each phase
  if (config.phases) {
    for (const [phaseName, phaseConfig] of Object.entries(config.phases)) {
      if (typeof phaseConfig !== "object" || phaseConfig === null) continue;

      const phaseObj = phaseConfig as Record<string, unknown>;

      // Validate verify field in phase (if present)
      if (phaseObj.verify !== undefined) {
        if (!ALLOWED_VERIFY_STRATEGIES.includes(phaseObj.verify as any)) {
          errors.push({
            path: `phases.${phaseName}.verify`,
            message: `must be one of: ${ALLOWED_VERIFY_STRATEGIES.join(", ")} (got "${phaseObj.verify}")`,
          });
        }
      }

      // Validate verify_timeout in phase (if present)
      if (phaseObj.verify_timeout !== undefined) {
        if (!Number.isInteger(phaseObj.verify_timeout) || phaseObj.verify_timeout <= 0) {
          errors.push({
            path: `phases.${phaseName}.verify_timeout`,
            message: `must be a positive integer (got ${phaseObj.verify_timeout})`,
          });
        }
      }

      // Validate max_iterations_per_phase in phase (if present)
      if (phaseObj.max_iterations_per_phase !== undefined) {
        if (!Number.isInteger(phaseObj.max_iterations_per_phase) || phaseObj.max_iterations_per_phase <= 0) {
          errors.push({
            path: `phases.${phaseName}.max_iterations_per_phase`,
            message: `must be a positive integer (got ${phaseObj.max_iterations_per_phase})`,
          });
        }
      }

      // Validate max_iterations_per_item in phase (if present)
      if (phaseObj.max_iterations_per_item !== undefined) {
        if (!Number.isInteger(phaseObj.max_iterations_per_item) || phaseObj.max_iterations_per_item <= 0) {
          errors.push({
            path: `phases.${phaseName}.max_iterations_per_item`,
            message: `must be a positive integer (got ${phaseObj.max_iterations_per_item})`,
          });
        }
      }

      // Validate stall_timeout in phase (if present)
      if (phaseObj.stall_timeout !== undefined) {
        if (!Number.isInteger(phaseObj.stall_timeout) || phaseObj.stall_timeout <= 0) {
          errors.push({
            path: `phases.${phaseName}.stall_timeout`,
            message: `must be a positive integer (got ${phaseObj.stall_timeout})`,
          });
        }
      }

      // Validate execution_order in phase (if present)
      if (phaseObj.execution_order !== undefined) {
        if (!ALLOWED_EXECUTION_ORDERS.includes(phaseObj.execution_order as any)) {
          errors.push({
            path: `phases.${phaseName}.execution_order`,
            message: `must be one of: ${ALLOWED_EXECUTION_ORDERS.join(", ")} (got "${phaseObj.execution_order}")`,
          });
        }
      }

      // Validate parallel_lanes in phase (if present)
      if (phaseObj.parallel_lanes !== undefined) {
        if (!Number.isInteger(phaseObj.parallel_lanes) || phaseObj.parallel_lanes <= 0) {
          errors.push({
            path: `phases.${phaseName}.parallel_lanes`,
            message: `must be a positive integer (got ${phaseObj.parallel_lanes})`,
          });
        }
      }

      // Validate rollback_on_failure in phase (if present)
      if (phaseObj.rollback_on_failure !== undefined) {
        if (!ALLOWED_ROLLBACK_STRATEGIES.includes(phaseObj.rollback_on_failure as any)) {
          errors.push({
            path: `phases.${phaseName}.rollback_on_failure`,
            message: `must be one of: ${ALLOWED_ROLLBACK_STRATEGIES.join(", ")} (got "${phaseObj.rollback_on_failure}")`,
          });
        }
      }

      // Validate changeset_bump in phase (if present)
      if (phaseObj.changeset_bump !== undefined) {
        if (!ALLOWED_CHANGESET_BUMPS.includes(phaseObj.changeset_bump as any)) {
          errors.push({
            path: `phases.${phaseName}.changeset_bump`,
            message: `must be one of: ${ALLOWED_CHANGESET_BUMPS.join(", ")} (got "${phaseObj.changeset_bump}")`,
          });
        }
      }

      // Validate log_level in phase (if present)
      if (phaseObj.log_level !== undefined) {
        if (!PINO_LEVELS.includes(phaseObj.log_level as any)) {
          errors.push({
            path: `phases.${phaseName}.log_level`,
            message: `must be a valid pino level (${PINO_LEVELS.join(", ")}) (got "${phaseObj.log_level}")`,
          });
        }
      }

      // Validate hooks in phase (if present)
      if (phaseObj.hooks && typeof phaseObj.hooks === "object") {
        const phaseHooks = phaseObj.hooks as Record<string, unknown>;
        for (const [hookName, hookValue] of Object.entries(phaseHooks)) {
          if (Array.isArray(hookValue)) {
            for (let i = 0; i < hookValue.length; i++) {
              if (typeof hookValue[i] !== "string" || hookValue[i].trim() === "") {
                errors.push({
                  path: `phases.${phaseName}.hooks.${hookName}[${i}]`,
                  message: "hook command must be a non-empty string",
                });
              }
            }
          } else if (typeof hookValue === "string") {
            if (hookValue.trim() === "") {
              errors.push({
                path: `phases.${phaseName}.hooks.${hookName}`,
                message: "hook command must be a non-empty string",
              });
            }
          }
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
