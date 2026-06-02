/**
 * Map anthropic API model names to Bedrock inference profile IDs per-region.
 *
 * The proxy doesn't pin a model at startup — each request from the harness
 * (claude-code, opencode, etc.) carries its own model name in the body. A
 * single session typically uses several models (main + summarizer + planner).
 * This module is the per-request translator.
 *
 * Pass-through behavior:
 *   - Anything that already looks like a Bedrock ID (contains `.anthropic.`,
 *     starts with a region prefix, or starts with `arn:`) is returned as-is.
 *   - Anything else is matched against the catalog below.
 *
 * Catalog scope (v0): claude-4.x family (haiku/sonnet/opus 4-5/4-6/4-7/4-8 and
 * dated variants). Older 3.x models can be added when needed.
 */

export type RegionPrefix = "us" | "eu" | "apac" | "au" | "jp" | "global" | "none";

interface ClaudeMapping {
  /**
   * Anthropic API model names that map to this Bedrock family. Multiple
   * aliases per entry — e.g., `claude-sonnet-4-5` and
   * `claude-sonnet-4-5-20250929` both target the same Bedrock profile.
   */
  aliases: string[];
  /**
   * The Bedrock model-name *suffix* (everything after the region prefix). For
   * the `none` form, this is the full model ID — used by Bedrock entries that
   * don't have regional inference profiles (e.g. `amazon-bedrock/anthropic.claude-sonnet-4-6`).
   */
  suffix: string;
  /**
   * Which region prefixes Bedrock publishes for this family. We pick the
   * caller's prefix if present; otherwise fall back in this order:
   *   user-region prefix → global → none → first available
   */
  availableIn: RegionPrefix[];
}

// Source: `opencode models | grep ^amazon-bedrock` against current Bedrock.
// Each entry maps an anthropic-API family to its Bedrock suffix + regions.
const CLAUDE_CATALOG: ClaudeMapping[] = [
  {
    aliases: ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
    suffix: "anthropic.claude-haiku-4-5-20251001-v1:0",
    availableIn: ["us", "eu", "au", "global", "none"],
  },
  {
    aliases: ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],
    suffix: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    availableIn: ["us", "eu", "au", "jp", "global", "none"],
  },
  {
    aliases: ["claude-sonnet-4-6"],
    suffix: "anthropic.claude-sonnet-4-6",
    availableIn: ["us", "eu", "au", "jp", "global", "none"],
  },
  {
    aliases: ["claude-opus-4-1", "claude-opus-4-1-20250805"],
    suffix: "anthropic.claude-opus-4-1-20250805-v1:0",
    availableIn: ["us", "none"],
  },
  {
    aliases: ["claude-opus-4-5", "claude-opus-4-5-20251101"],
    suffix: "anthropic.claude-opus-4-5-20251101-v1:0",
    availableIn: ["us", "eu", "global", "none"],
  },
  {
    aliases: ["claude-opus-4-6", "claude-opus-4-6-v1"],
    suffix: "anthropic.claude-opus-4-6-v1",
    availableIn: ["us", "eu", "au", "global", "none"],
  },
  {
    aliases: ["claude-opus-4-7"],
    suffix: "anthropic.claude-opus-4-7",
    availableIn: ["us", "eu", "jp", "global", "none"],
  },
  {
    aliases: ["claude-opus-4-8"],
    suffix: "anthropic.claude-opus-4-8",
    availableIn: ["us", "eu", "au", "jp", "global", "none"],
  },
];

export function regionPrefix(region: string): RegionPrefix {
  const r = region.toLowerCase();
  if (r.startsWith("us-") || r.startsWith("us-gov-")) return "us";
  if (r.startsWith("eu-")) return "eu";
  if (r.startsWith("ap-southeast-2")) return "au";
  if (r.startsWith("ap-northeast-1")) return "jp";
  if (r.startsWith("ap-")) return "apac";
  return "global"; // safest fallback — global inference profile works from any region
}

/** True if the string already looks like a Bedrock model ID. */
function looksLikeBedrockId(model: string): boolean {
  if (model.startsWith("arn:")) return true;
  if (model.includes(".anthropic.")) return true;
  if (model.startsWith("anthropic.")) return true;
  // Region-prefixed forms: us.X, eu.X, global.X, au.X, jp.X
  return /^(us|eu|apac|au|jp|global)\./.test(model);
}

/** Strip a leading `anthropic/` provider prefix if present. */
function stripProviderPrefix(model: string): string {
  if (model.startsWith("anthropic/")) return model.slice("anthropic/".length);
  return model;
}

/**
 * Resolve a model name from the wire (anthropic API form, or already-Bedrock)
 * to a Bedrock inference profile ID for the given region. Returns null if no
 * mapping is known.
 */
export function bedrockFromAnthropic(
  model: string,
  region: string,
): string | null {
  const stripped = stripProviderPrefix(model);
  if (looksLikeBedrockId(stripped)) return stripped;

  const entry = CLAUDE_CATALOG.find((e) => e.aliases.includes(stripped));
  if (!entry) return null;

  const prefix = regionPrefix(region);
  const preferred: RegionPrefix[] = [prefix, "global", "none"];
  for (const p of preferred) {
    if (entry.availableIn.includes(p)) {
      return p === "none" ? entry.suffix : `${p}.${entry.suffix}`;
    }
  }
  // Last resort: any region the model is published in.
  const fallback = entry.availableIn[0];
  return fallback === "none" ? entry.suffix : `${fallback}.${entry.suffix}`;
}

/** List of known anthropic API model names. Used in error messages. */
export function knownAnthropicModels(): string[] {
  return CLAUDE_CATALOG.flatMap((e) => e.aliases).sort();
}

export class ModelNotFound extends Error {
  readonly code = "MODEL_NOT_FOUND";
  readonly status = 400;
  constructor(
    public readonly model: string,
    public readonly region: string,
  ) {
    super(
      `no Bedrock mapping for model '${model}' in region '${region}'.\n` +
        `  known anthropic-API names:\n    ${knownAnthropicModels().join("\n    ")}\n` +
        `  or pass a full Bedrock inference profile ID directly (e.g. us.anthropic.claude-sonnet-4-5-20250929-v1:0).`,
    );
    this.name = "ModelNotFound";
  }
}
