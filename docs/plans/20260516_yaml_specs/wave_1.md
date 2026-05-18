# Wave 1 — Routing + Loop Session Integration

**Focus:** Wire the YAML parser into the plan-parser routing layer and the loop-session orchestrator. After this wave, plans with `spec/` directories execute via YAML.

---

## Items

- [ ] 1.1 **Plan-parser routing.** Add `hasSpec()` gate at the top of `parsePlanState()`, `parseItems()`, `detectPhaseFiles()` in `plan-parser.ts`. When `spec/` exists, delegate to spec-parser functions. Otherwise fall through to existing regex logic (unchanged). Public API stays identical — callers don't know which backend was used.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-parser.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/test/plan-parser.test.ts` — add routing tests
  - verify: `cd packages/harness-opencode && bun test test/plan-parser.test.ts`

- [ ] 1.2 **Goal/constraints from YAML.** In `loop-session.ts`, when spec exists, read `goal` and `constraints` from `parseSpecState()` result instead of `extractSection()` regex. The `extractSection` function stays for the markdown fallback path.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts`
  - verify: `cd packages/harness-opencode && bun test test/loop-session.test.ts`

- [ ] 1.3 **Phase detection from YAML.** In `loop-session.ts`, when spec exists, read the `phases` array from `spec/main.yaml` instead of scanning the directory with regex. `filterUncheckedPhases` checks the YAML `completed` field instead of counting checkboxes.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts`
  - files (NEW):
    - `packages/harness-opencode/test/loop-session-yaml.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/loop-session-yaml.test.ts`

- [ ] 1.4 **Phase completion via YAML.** Replace `markPhaseChecked()` regex replacement with `spec-writer.markPhaseCompleted()` when spec exists. Replace per-item checkbox marking in `runItemsForPhase` with `spec-writer.markItemChecked()`.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts`
  - verify: `cd packages/harness-opencode && bun test test/loop-session-yaml.test.ts`
