# Wave 1 — Content-Hash Enrichment Cache

### 1.1 Compute and store plan content hash
- intent: Add a `computePlanHash(planDir)` function to `plan-enrichment.ts` that computes a SHA-256 hash over the sorted concatenation of all `.md` files in the plan directory (excluding `spec/`). The hash captures the exact plan content that enrichment would process. After successful enrichment, write the hash to `spec/.plan-hash` alongside the YAML files. This is a single hex string, no metadata.
- files:
    - packages/autopilot/src/plan-enrichment.ts (MODIFY)
- tests:
    - packages/autopilot/test/plan-enrichment-cache.test.ts
- verify: bun test packages/autopilot/test/plan-enrichment-cache.test.ts

### 1.2 Skip enrichment when hash matches
- intent: At the top of `enrichPlanForFastModel` (before the `enrich:start` event), read `spec/.plan-hash` if it exists. Compute the current plan hash. If they match AND `computeEnrichmentRatioYaml` returns >= 1.0 (all items enriched), skip enrichment entirely — emit `enrich:cache-hit` event and return. If the hash doesn't match (plan was edited), delete the entire `spec/` directory and re-enrich from scratch. This prevents stale specs from surviving plan edits. The existing `computeEnrichmentRatio` check (line 863) remains as a fallback for plans enriched before the hash feature existed.
- files:
    - packages/autopilot/src/plan-enrichment.ts (MODIFY)
    - packages/autopilot/src/session-runner.ts (MODIFY — handle new `enrich:cache-hit` event type)
- tests:
    - packages/autopilot/test/plan-enrichment-cache.test.ts
- verify: bun test packages/autopilot/test/plan-enrichment-cache.test.ts

### 1.3 Invalidate cache on strategy change
- intent: Include the enrichment strategy file content in the hash computation. `computePlanHash` should also read the active strategy file (resolved from config or default at `strategies/default.md`) and append its content to the hash input. This ensures that changing the enrichment prompt invalidates the cached spec even if plan markdown is unchanged.
- files:
    - packages/autopilot/src/plan-enrichment.ts (MODIFY)
- tests:
    - packages/autopilot/test/plan-enrichment-cache.test.ts
- verify: bun test packages/autopilot/test/plan-enrichment-cache.test.ts
