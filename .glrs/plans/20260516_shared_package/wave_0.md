# Wave 0 — Package scaffold + migrate duplicated lib modules

**Focus:** Create `packages/shared/`, move the 6 identical lib modules from autopilot and harness-opencode into it, re-export from both packages so downstream imports don't break yet.

---

## Items

- [ ] 0.1 **Create `packages/shared/` scaffold.** `package.json` (`@glrs-dev/shared`, private, `"main": "src/index.ts"`), `tsconfig.json` (extends `../../tsconfig.base.json`, `"types": ["bun"]`). Add `execa` (^9), `pino` (^9), `yaml` (^2) as dependencies. Verify `bun install` links the workspace.

  - files (NEW):
    - `packages/shared/package.json`
    - `packages/shared/tsconfig.json`
    - `packages/shared/src/index.ts` (empty barrel)
  - verify: `bun install && cd packages/shared && tsc --noEmit`

- [ ] 0.2 **Move logger.ts.** Copy `packages/autopilot/src/lib/logger.ts` → `packages/shared/src/logger.ts`. Export `createAutopilotLogger`, `childLogger`, `AutopilotLogger` type from `packages/shared/src/index.ts`. Update `packages/autopilot/src/lib/logger.ts` to re-export from `@glrs-dev/shared` (thin shim so existing imports don't break). Update `packages/harness-opencode/src/lib/logger.ts` the same way.

  - files (NEW):
    - `packages/shared/src/logger.ts`
  - files (MODIFIED):
    - `packages/shared/src/index.ts`
    - `packages/autopilot/src/lib/logger.ts` → re-export shim
    - `packages/harness-opencode/src/lib/logger.ts` → re-export shim
    - `packages/autopilot/package.json` → add `@glrs-dev/shared: workspace:*`
    - `packages/harness-opencode/package.json` → add `@glrs-dev/shared: workspace:*`
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 0.3 **Move error-classifier.ts.** Same pattern: copy to shared, re-export shims in autopilot and harness-opencode.

  - files (NEW): `packages/shared/src/error-classifier.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`, both `src/lib/error-classifier.ts` shims
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 0.4 **Move credential-refresh.ts.** Same pattern.

  - files (NEW): `packages/shared/src/credential-refresh.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`, both shims
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 0.5 **Move model-pricing.ts.** Same pattern.

  - files (NEW): `packages/shared/src/model-pricing.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`, both shims
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 0.6 **Move slack-formatter.ts.** Same pattern.

  - files (NEW): `packages/shared/src/slack-formatter.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`, both shims
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 0.7 **Move webhook-notifier.ts.** Same pattern. Normalize the `console.warn` vs `process.stderr.write` divergence — use `console.warn` (the shared version should not assume a TTY).

  - files (NEW): `packages/shared/src/webhook-notifier.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`, both shims
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test`

- [ ] 0.8 **Add shared package tests.** Write tests for the 6 moved modules in `packages/shared/test/`. These can be thin — the real tests are in autopilot and harness-opencode. Focus on: logger creates file sink, error classifier categorizes known patterns, credential-refresh detects providers.

  - files (NEW):
    - `packages/shared/test/logger.test.ts`
    - `packages/shared/test/error-classifier.test.ts`
    - `packages/shared/test/credential-refresh.test.ts`
  - verify: `cd packages/shared && bun test`
