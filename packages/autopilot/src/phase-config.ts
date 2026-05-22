/**
 * Phase-specific configuration resolution for autopilot.
 *
 * Provides utilities to resolve per-phase config by deep-merging
 * phase-specific overrides from `config.phases.<phase-name>` over
 * the base configuration.
 */

/**
 * Deep-merge multiple objects with right-to-left precedence.
 * Arrays are replaced (not concatenated); objects recurse; scalars overwrite.
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
 * Resolve phase-specific configuration by merging phase overrides
 * from `baseConfig.phases?.[phaseName]` over the base config.
 *
 * If the phase is not found in the config, returns the base config unchanged.
 *
 * @param baseConfig The resolved base configuration
 * @param phaseName The phase name without extension (e.g., `wave_0`)
 * @returns A config object with phase-specific overrides merged in
 */
export function resolvePhaseConfig(
  baseConfig: unknown,
  phaseName: string,
): Record<string, unknown> {
  // Handle null/undefined/non-object baseConfig
  if (!baseConfig || typeof baseConfig !== "object" || Array.isArray(baseConfig)) {
    return {};
  }

  const base = baseConfig as Record<string, unknown>;
  const phases = base.phases as Record<string, unknown> | undefined;
  if (!phases || typeof phases !== "object") {
    return base;
  }

  const phaseOverride = phases[phaseName];
  if (!phaseOverride || typeof phaseOverride !== "object" || Array.isArray(phaseOverride)) {
    return base;
  }

  return deepMerge(base, phaseOverride as Record<string, unknown>);
}
