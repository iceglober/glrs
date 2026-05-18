# Wave 0 — Schema + Parser + Writer

**Focus:** Build the three new modules that handle YAML spec files. No integration with existing code yet — these are standalone, fully tested modules.

---

## Items

- [ ] 0.1 **YAML schema definition.** Define `MainSpec`, `PhaseSpec`, `SpecItem`, `SpecFileEntry` interfaces in `spec-schema.ts`. Add runtime validators `validateMainSpec()` and `validatePhaseSpec()` that return structured errors for missing/invalid fields. These types map 1:1 to the YAML structure; downstream code converts them to existing `PlanState`/`PlanItem` types.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/spec-schema.ts`
    - `packages/harness-opencode/test/spec-schema.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/spec-schema.test.ts`

- [ ] 0.2 **YAML spec parser.** Create `spec-parser.ts` exporting `hasSpec(planDir)`, `parseSpecState(planDir)`, `parseSpecItems(phasePath)`, `detectSpecPhases(planDir)`. Reads `spec/main.yaml` and `spec/<phase>.yaml` via `yaml.parse()`, validates against schema, converts to `PlanState`/`PlanItem[]`/`string[]`. The `hasSpec()` function checks for `spec/main.yaml` existence — this is the gate all consumers use.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/spec-parser.ts`
    - `packages/harness-opencode/test/spec-parser.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/spec-parser.test.ts`

- [ ] 0.3 **YAML spec writer.** Create `spec-writer.ts` exporting `markItemChecked(planDir, phaseFile, itemId)`, `markPhaseCompleted(planDir, phaseFile)`, `writeEnrichmentFields(planDir, phaseFile, itemId, fields)`. Reads existing YAML, merges updates, writes back via `yaml.stringify()`. Preserves existing fields and comments where possible.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/spec-writer.ts`
    - `packages/harness-opencode/test/spec-writer.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/spec-writer.test.ts`
