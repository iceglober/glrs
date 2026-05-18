/**
 * Adapter-aware model resolver. Resolves a model specifier to a concrete model ID
 * based on the active adapter (OpenCode or Claude Code CLI).
 *
 * Both adapters support:
 * - Full model IDs containing "/" (e.g., "amazon-bedrock/claude-opus") pass through unchanged
 *
 * OpenCode adapter:
 * - Tier names resolve through `opencodeTiers` map
 * - Unknown tier names fall back to `opencodeTiers?.deep` with a warning
 * - Array-valued tiers return the first element
 *
 * Claude Code CLI adapter:
 * - Known tier aliases map to specific Claude model IDs
 * - Unknown literals pass through unchanged
 */

export type AdapterName = "opencode" | "claude-code-cli";

const CLAUDE_TIER_ALIASES: Record<string, string> = {
  deep: "claude-opus-4-7",
  mid: "claude-sonnet-4-6",
  "mid-execute": "claude-sonnet-4-6",
  "autopilot-execute": "claude-sonnet-4-6",
  fast: "claude-haiku-4-5-20251001",
};

// Dedupe warnings within a single call.
let warnedOnce: Set<string> | null = null;

function warn(message: string): void {
  if (!warnedOnce) warnedOnce = new Set();
  if (warnedOnce.has(message)) return;
  warnedOnce.add(message);
  console.warn(`[model-resolver] ${message}`);
}

export function resolveModel(
  specifier: string,
  adapterName: AdapterName,
  opencodeTiers?: Record<string, string | string[]>,
): string {
  // Full model IDs containing "/" pass through for both adapters.
  if (specifier.includes("/")) {
    return specifier;
  }

  if (adapterName === "claude-code-cli") {
    // Try to map as a known tier alias.
    if (specifier in CLAUDE_TIER_ALIASES) {
      return CLAUDE_TIER_ALIASES[specifier]!;
    }
    // Unknown literal — pass through unchanged.
    return specifier;
  }

  // OpenCode adapter.
  if (!opencodeTiers) {
    // No tier config provided — pass through.
    return specifier;
  }

  // Try to resolve from opencodeTiers.
  const resolved = opencodeTiers[specifier];
  if (resolved !== undefined) {
    // Array-valued tiers return the first element.
    return Array.isArray(resolved) ? resolved[0]! : resolved;
  }

  // Not found — try to fall back to "deep".
  const fallback = opencodeTiers["deep"];
  if (fallback !== undefined) {
    warn(`Unknown tier "${specifier}"; falling back to "deep"`);
    return Array.isArray(fallback) ? fallback[0]! : fallback;
  }

  // No "deep" fallback available — pass through.
  return specifier;
}
