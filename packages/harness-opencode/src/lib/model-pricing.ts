/**
 * Model pricing table and cost estimation for mid-run cost visibility.
 *
 * Since Bedrock doesn't report cost mid-stream, we estimate from token counts.
 * Prices are USD per million tokens.
 *
 * Estimation formula:
 *   cost = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
 *
 * Unknown model IDs return 0 — the caller decides whether to show "pending"
 * or "$0.00 est".
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
 * `modelId.includes(key)` in priority order — more specific keys first).
 *
 * Prices as of 2024-06 (USD per million tokens):
 *   - Claude 3 Opus:   $15 input / $75 output
 *   - Claude 3.5 Sonnet / Claude 3 Sonnet: $3 input / $15 output
 *   - Claude 3 Haiku:  $0.25 input / $1.25 output
 *   - Claude 3.5 Haiku: $0.80 input / $4.00 output
 *   - Claude 3 Sonnet: $3 input / $15 output
 *
 * GLM-5 and Kimi pricing are TBD — they return 0 (unknown).
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude 3 Opus
  "claude-3-opus": { input: 15, output: 75 },
  "claude-opus": { input: 15, output: 75 },

  // Claude 3.5 Sonnet (more specific than "sonnet" — check first)
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3.5-sonnet": { input: 3, output: 15 },

  // Claude 3.7 Sonnet
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3.7-sonnet": { input: 3, output: 15 },

  // Claude 3 Sonnet (generic)
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-sonnet": { input: 3, output: 15 },

  // Claude 3.5 Haiku (more specific than "haiku" — check first)
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3.5-haiku": { input: 0.8, output: 4 },

  // Claude 3 Haiku (generic)
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-haiku": { input: 0.25, output: 1.25 },

  // Amazon Nova models (approximate)
  "amazon.nova-pro": { input: 0.8, output: 3.2 },
  "amazon.nova-lite": { input: 0.06, output: 0.24 },
  "amazon.nova-micro": { input: 0.035, output: 0.14 },

  // GLM-5 and Kimi: TBD — return 0 via unknown-model fallback
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
 * @param modelId - The model ID string (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0")
 * @param tokens - Input and output token counts
 * @returns Estimated cost in USD
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
