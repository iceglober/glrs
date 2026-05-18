/**
 * Config reader for autopilot configuration files.
 *
 * Reads `.glrs/autopilot.yaml` from a given repo root, parses with the yaml package,
 * validates against the AutopilotConfig schema, and rejects unknown keys with a clear
 * error message listing the bad fields.
 *
 * Returns `Partial<AutopilotConfig>` or `null` when the file doesn't exist.
 * Never throws on a missing file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { AutopilotConfig } from "./autopilot-config.js";

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
        const path = issue.path.join(".");
        return `${path || "root"}: ${issue.message}`;
      });
      throw new Error(`Invalid ${ConfigPath}:\n${messages.join("\n")}`);
    }
    throw err;
  }
}
