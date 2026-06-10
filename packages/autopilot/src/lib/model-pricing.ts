/**
 * Model pricing table and cost estimation for mid-run cost visibility.
 *
 * Since Bedrock doesn't report cost mid-stream, we estimate from token counts.
 * Prices are USD per million tokens.
 *
 * Estimation formula:
 *   cost = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
 *
 * LIMITATIONS — this is a display estimate (flagged `costIsEstimated` in the
 * TUI), not an accounting number:
 *   - Cache read/write tokens are NOT included. On cache-heavy agent
 *     workloads cache reads dominate real cost (90%+ observed), so this
 *     estimate is a floor. The authoritative number arrives when the
 *     provider reports cost at finalization (cost-tracker / model_turn).
 *   - Unknown model IDs return 0 — the caller shows "pending", not "$0.00".
 */

// ---------------------------------------------------------------------------
// Pricing table
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * Hardcoded pricing table. Keys are model ID substrings (matched via
 * `modelId.includes(key)` in declaration order — more specific keys first,
 * generic family catch-alls last).
 *
 * Anthropic prices as of 2026-05 (USD per million tokens):
 *   - Fable 5:                  $10 / $50
 *   - Opus 4.5–4.8:             $5 / $25  (repriced at 4.5; 4.0/4.1 were $15/$75)
 *   - Sonnet (3.x–4.6):         $3 / $15
 *   - Haiku 4.5:                $1 / $5
 *   - Haiku 3.5:                $0.80 / $4
 *   - Haiku 3:                  $0.25 / $1.25
 *   - Claude 3 Opus (legacy):   $15 / $75
 * GLM-5 (Bedrock) from the models.dev catalog. Kimi/Qwen: unknown → 0.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Fable tier
  "claude-fable-5": { input: 10, output: 50 },

  // Legacy Opus generations that kept the old price (specific — checked first)
  "claude-3-opus": { input: 15, output: 75 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4-20250514": { input: 15, output: 75 },

  // Current Opus (4.5+ repriced) — generic catch-all
  "claude-opus": { input: 5, output: 25 },

  // Sonnet — every shipped Sonnet generation is $3/$15; specific spellings
  // kept for clarity even though the generic key would match.
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3.5-sonnet": { input: 3, output: 15 },
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3.7-sonnet": { input: 3, output: 15 },
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-sonnet": { input: 3, output: 15 },

  // Haiku — legacy generations first (cheaper), then current catch-all
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3.5-haiku": { input: 0.8, output: 4 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-haiku": { input: 1, output: 5 },

  // Amazon Nova models (approximate)
  "amazon.nova-pro": { input: 0.8, output: 3.2 },
  "amazon.nova-lite": { input: 0.06, output: 0.24 },
  "amazon.nova-micro": { input: 0.035, output: 0.14 },

  // GLM-5 via Bedrock (models.dev catalog rate)
  "glm-5": { input: 1, output: 3.2 },

  // Kimi and Qwen: unknown — return 0 via the unknown-model fallback
};

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

/**
 * Estimate the cost of a model invocation from token counts.
 *
 * Returns 0 for unknown model IDs. The caller should treat 0 as "unknown"
 * and display "pending" rather than "$0.00 est".
 *
 * @param modelId - The model ID string (e.g., "anthropic.claude-sonnet-4-6")
 * @param tokens - Input and output token counts
 * @returns Estimated cost in USD (cache tokens excluded — see module note)
 */
export function estimateCost(
  modelId: string,
  tokens: { input: number; output: number },
): number {
  const pricing = findPricing(modelId);
  if (!pricing) return 0;
  return (tokens.input * pricing.input + tokens.output * pricing.output) / 1_000_000;
}

/**
 * Find the pricing entry for a model ID by substring matching.
 * Returns undefined for unknown models.
 */
export function findPricing(modelId: string): ModelPricing | undefined {
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key.toLowerCase())) {
      return pricing;
    }
  }
  return undefined;
}
