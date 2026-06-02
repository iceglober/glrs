/**
 * Resolve short model names (sonnet, haiku, opus) to Bedrock cross-region
 * inference profile IDs, scoped by AWS region prefix.
 *
 * Full ARNs and inference-profile IDs pass through unchanged. This keeps the
 * wrap UX terse (`--model sonnet`) without locking us out of explicit IDs.
 *
 * v0 covers the Claude family on US/EU/APAC. Add other families (Nova, Llama,
 * Mistral) as they become relevant.
 */

export interface ModelEntry {
  /** Short name the user types: `sonnet`, `opus`, `haiku`. */
  shortName: string;
  /** Map from AWS region prefix (us, eu, apac, global) → inference profile id. */
  perRegion: Record<string, string>;
}

const CATALOG: ModelEntry[] = [
  {
    shortName: "sonnet",
    perRegion: {
      us: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      eu: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
      apac: "apac.anthropic.claude-sonnet-4-5-20250929-v1:0",
      global: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    },
  },
  {
    shortName: "opus",
    perRegion: {
      us: "us.anthropic.claude-opus-4-7-20251115-v1:0",
      global: "global.anthropic.claude-opus-4-7-20251115-v1:0",
    },
  },
  {
    shortName: "haiku",
    perRegion: {
      us: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      eu: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      global: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    },
  },
];

export function regionPrefix(region: string): string {
  const r = region.toLowerCase();
  if (r.startsWith("us-")) return "us";
  if (r.startsWith("eu-")) return "eu";
  if (r.startsWith("ap-")) return "apac";
  return "us"; // best-effort default
}

/**
 * Resolve a user-supplied model identifier against the target region. Returns
 * the inference profile / model ID to actually invoke. Throws `ModelNotFound`
 * if a short name has no entry for the prefix.
 */
export function resolveModel(model: string, region: string): string {
  // Anything containing a dot or colon is treated as an explicit ID/ARN.
  if (model.includes(".") || model.includes(":") || model.startsWith("arn:")) {
    return model;
  }
  const entry = CATALOG.find((e) => e.shortName === model);
  if (!entry) {
    throw new ModelNotFound(
      `unknown model '${model}'. Known short names: ${CATALOG.map((e) => e.shortName).join(", ")}. ` +
        `Or pass a full Bedrock inference profile ID like 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'.`,
    );
  }
  const prefix = regionPrefix(region);
  const id = entry.perRegion[prefix] ?? entry.perRegion.global;
  if (!id) {
    const available = Object.keys(entry.perRegion)
      .map((p) => `${p} (${exampleRegion(p)})`)
      .join(", ");
    throw new ModelNotFound(
      `model '${model}' is not available in '${region}'. Available region prefixes: ${available}.`,
    );
  }
  return id;
}

function exampleRegion(prefix: string): string {
  if (prefix === "us") return "us-east-1";
  if (prefix === "eu") return "eu-west-1";
  if (prefix === "apac") return "ap-southeast-1";
  if (prefix === "global") return "any";
  return prefix;
}

export class ModelNotFound extends Error {
  readonly code = "MODEL_NOT_FOUND";
  constructor(msg: string) {
    super(msg);
    this.name = "ModelNotFound";
  }
}
