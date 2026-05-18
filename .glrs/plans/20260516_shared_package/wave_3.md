# Wave 3 — Delete duplicates, update all imports, verify

**Focus:** Now that shared owns the canonical implementations and all consumers import from it, delete the duplicate files and re-export shims. Clean up any remaining direct imports of the old paths. Full test suite verification.

---

## Items

- [ ] 3.1 **Delete autopilot lib duplicates.** Remove `packages/autopilot/src/lib/` entirely — all 6 modules now live in `@glrs-dev/shared`. Update `packages/autopilot/src/index.ts` to re-export logger/error-classifier types from `@glrs-dev/shared` (so downstream consumers like cli that import from `@glrs-dev/autopilot` still get the types).

  - files (DELETED):
    - `packages/autopilot/src/lib/logger.ts`
    - `packages/autopilot/src/lib/error-classifier.ts`
    - `packages/autopilot/src/lib/credential-refresh.ts`
    - `packages/autopilot/src/lib/model-pricing.ts`
    - `packages/autopilot/src/lib/slack-formatter.ts`
    - `packages/autopilot/src/lib/webhook-notifier.ts`
  - files (MODIFIED):
    - `packages/autopilot/src/index.ts` — re-export types from `@glrs-dev/shared`
    - Every `packages/autopilot/src/*.ts` that imports from `./lib/logger.js` etc. → change to `@glrs-dev/shared`
  - verify: `cd packages/autopilot && bun test`

- [ ] 3.2 **Delete harness-opencode lib duplicates.** Remove the 6 duplicate modules from `packages/harness-opencode/src/lib/`. Update all imports to use `@glrs-dev/shared`.

  - files (DELETED):
    - `packages/harness-opencode/src/lib/logger.ts`
    - `packages/harness-opencode/src/lib/error-classifier.ts`
    - `packages/harness-opencode/src/lib/credential-refresh.ts`
    - `packages/harness-opencode/src/lib/model-pricing.ts`
    - `packages/harness-opencode/src/lib/slack-formatter.ts`
    - `packages/harness-opencode/src/lib/webhook-notifier.ts`
  - files (MODIFIED):
    - Every `packages/harness-opencode/src/*.ts` that imports from `./lib/logger.js` etc. → change to `@glrs-dev/shared`
  - verify: `cd packages/harness-opencode && bun test`

- [ ] 3.3 **Delete triplicated plan-paths.ts.** Remove `packages/autopilot/src/plan-paths.ts` and `packages/harness-opencode/src/plan-paths.ts`. Update `packages/cli/src/plan-paths.ts` to be a thin re-export from `@glrs-dev/shared`. Update all imports across all packages.

  - files (DELETED):
    - `packages/autopilot/src/plan-paths.ts`
    - `packages/harness-opencode/src/plan-paths.ts`
  - files (MODIFIED):
    - `packages/cli/src/plan-paths.ts` → re-export from `@glrs-dev/shared`
    - All files that import from the deleted paths
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test && cd ../cli && bun test`

- [ ] 3.4 **Update test imports.** Test files in autopilot and harness-opencode that import from `../src/lib/logger.js` etc. need to import from `@glrs-dev/shared` or from the re-export in the package's index. Verify all test files compile and pass.

  - files (MODIFIED): `packages/autopilot/test/*.test.ts`, `packages/harness-opencode/test/*.test.ts` — any that reference the deleted lib paths
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 3.5 **Audit for stale imports.** Run `grep -rn "from.*\./lib/logger\|from.*\./lib/error-classifier\|from.*\./lib/credential-refresh\|from.*\./lib/model-pricing\|from.*\./lib/slack-formatter\|from.*\./lib/webhook-notifier" packages/autopilot/src/ packages/harness-opencode/src/ packages/cli/src/` — should return zero results. Fix any stragglers.

  - verify: grep returns 0 results

- [ ] 3.6 **Full cross-package test run.** Run the complete test suite across all packages to confirm nothing is broken.

  - verify:
    - `cd packages/shared && bun test`
    - `cd packages/autopilot && bun test`
    - `cd packages/adapter-opencode && bun test`
    - `cd packages/cli && bun test`
    - `cd packages/harness-opencode && bun test`

- [ ] 3.7 **Update AGENTS.md files.** Update `packages/autopilot/AGENTS.md` (if it exists) and root `AGENTS.md` to document the new `packages/shared/` package and its role. Add `packages/shared/AGENTS.md` describing the package's purpose and conventions.

  - files (NEW): `packages/shared/AGENTS.md`
  - files (MODIFIED): root `AGENTS.md` — add shared to the package table
  - verify: files exist and are accurate
