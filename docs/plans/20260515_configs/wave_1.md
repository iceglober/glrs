# Wave 1 — Enrichment Strategies + Retry

**Focus:** Make enrichment customizable via named strategies and resilient via retry-from-top on stall.

---

## Items

- [ ] 1.1 **Strategy file loader.** Read a named strategy from `.glrs/plan-enrich-strategies/<name>.md`. Resolution: plan-local `./strategies/` (future) > `.glrs/plan-enrich-strategies/` > built-in default. The built-in `default` strategy is the current `buildPerFilePrompt` output extracted to a file. Strategy files use `{{file}}` and `{{content}}` as substitution placeholders.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/enrich-strategy.ts` — `loadStrategy(repoRoot, name): string`, `applyStrategy(template, file, content): string`
    - `packages/harness-opencode/test/enrich-strategy.test.ts`
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/strategies/default.md` — extracted from current `buildPerFilePrompt`
  - verify: `bun test test/enrich-strategy.test.ts`

- [ ] 1.2 **Ship default strategy as a bundled file.** Extract the current `buildPerFilePrompt` body into `src/autopilot/strategies/default.md`. Update `tsup.config.ts` or the build's `onSuccess` to copy `src/autopilot/strategies/` to `dist/autopilot/strategies/`. Update `buildPerFilePrompt` to read from the bundled file instead of hardcoding the prompt string.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — replace hardcoded prompt with `loadStrategy` call
    - `packages/harness-opencode/tsup.config.ts` — copy strategies dir to dist (if not already handled)
  - verify: `bun run build && bun test`

- [ ] 1.3 **Strategy-aware idempotency check.** Today `computeEnrichmentRatio` checks for hardcoded `mirror/context/conventions` fields. Instead, parse the strategy's numbered list to extract field names (regex: `/^\d+\.\s+\*\*(\w+):\*\*/gm`) and check for those. Falls back to `mirror/context/conventions` when no strategy is loaded.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — `computeEnrichmentRatio` accepts field names
    - `packages/harness-opencode/src/autopilot/enrich-strategy.ts` — add `extractFieldNames(strategy): string[]`
  - files (MODIFIED):
    - `packages/harness-opencode/test/plan-enrichment.test.ts` — test with custom field names
  - verify: `bun test test/plan-enrichment.test.ts && bun test test/enrich-strategy.test.ts`

- [ ] 1.4 **Enrichment retry on stall/error.** When `config.enrichment.retry` is true (default: true), wrap the enrichment pass in a retry loop. On any file stall (exceeds `config.enrichment.stall_timeout`) or server error: kill the server, start a fresh one, restart the entire enrichment pass from the top. The per-file idempotency check skips already-enriched files, so retries only pay for failures. Up to `config.enrichment.max_retries` attempts (default: 3).

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — wrap `enrichPlanForFastModel` body in retry loop; accept `config.enrichment` settings
  - files (NEW):
    - `packages/harness-opencode/test/enrichment-retry.test.ts`
  - verify: `bun test test/enrichment-retry.test.ts`

- [ ] 1.5 **Wire strategy + retry into config.** Read `config.enrichment.strategy`, `config.enrichment.retry`, `config.enrichment.max_retries`, `config.enrichment.stall_timeout` from the resolved config and pass them into `enrichPlanForFastModel`. CLI `--fast` still triggers enrichment; the config controls *how* it runs.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — pass enrichment config fields
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — consume config fields
  - verify: `bun run build && bun test`
