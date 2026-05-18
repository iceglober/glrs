# Autopilot YAML spec migration

## Goal

Replace the autopilot's regex-based markdown plan parsing with structured YAML spec files. Plans gain a `spec/` subdirectory containing machine-readable YAML that the autopilot reads, writes, and executes against. Human-authored markdown stays untouched. All ~15 regex patterns in `plan-parser.ts` and the duplicate patterns scattered across `loop-session.ts`, `plan-enrichment.ts`, and `plan-validator.ts` are replaced by `yaml.parse()` calls against typed schemas. The markdown parser remains as a fallback for plans without a `spec/` directory.

## Constraints

- Backward compatibility: plans without `spec/` must still work via the existing markdown parser (no breaking change for existing plans)
- The `spec/` directory is autopilot-owned territory — it reads and writes there; markdown files are never modified by the autopilot
- The `yaml` package (already in `dependencies` at `^2.8.3`) is the parser — no new dependencies
- ESM imports with `.js` suffix per project convention
- `bun:test` for all new tests
- The `PlanItem`, `PlanState`, `PlanPhase`, `PlanFileEntry` interfaces remain the canonical internal types — YAML parsing produces these same shapes
- No changes to the planner/scoper agents in this plan (they'll need prompt updates to generate specs, but that's a follow-up)
- No changes to the declarative autopilot config (`.glrs/autopilot.yaml`) — separate effort

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: A new spec-parser module exists that reads YAML spec files and
          produces the same PlanItem/PlanState/PlanPhase types that the
          markdown parser produces. Given a plan directory with spec/main.yaml
          and spec/wave_0.yaml, the parser returns correct PlanState with
          phases, items, checked state, and all fields populated.
  tests:
    - packages/harness-opencode/test/spec-parser.test.ts::"parses main.yaml into PlanState with phases"
    - packages/harness-opencode/test/spec-parser.test.ts::"parses phase YAML into PlanItem array with all fields"
    - packages/harness-opencode/test/spec-parser.test.ts::"marks items checked when YAML has checked: true"
    - packages/harness-opencode/test/spec-parser.test.ts::"handles enrichment fields (mirror, context, conventions)"
  verify: cd packages/harness-opencode && bun test test/spec-parser.test.ts

- [x] id: a2
  intent: A YAML schema definition (TypeScript interfaces + runtime validation)
          exists for both main spec and phase spec files. Invalid YAML that
          doesn't match the schema produces clear error messages rather than
          silent data loss.
  tests:
    - packages/harness-opencode/test/spec-parser.test.ts::"rejects YAML missing required items field"
    - packages/harness-opencode/test/spec-parser.test.ts::"rejects item missing required id field"
    - packages/harness-opencode/test/spec-parser.test.ts::"rejects item missing required intent field"
  verify: cd packages/harness-opencode && bun test test/spec-parser.test.ts --test-name-pattern "rejects"

- [x] id: a3
  intent: A spec-writer module exists that can write/update YAML spec files.
          It can mark items as checked, update enrichment fields, and mark
          phases as completed — all by modifying the YAML files in spec/.
  tests:
    - packages/harness-opencode/test/spec-writer.test.ts::"marks item checked in phase YAML"
    - packages/harness-opencode/test/spec-writer.test.ts::"marks phase completed in main.yaml"
    - packages/harness-opencode/test/spec-writer.test.ts::"writes enrichment fields to item"
    - packages/harness-opencode/test/spec-writer.test.ts::"preserves existing fields when updating"
  verify: cd packages/harness-opencode && bun test test/spec-writer.test.ts

- [x] id: a4
  intent: The plan-parser module detects whether spec/ exists and routes to
          the YAML parser or falls back to the markdown parser. The public
          API (parsePlanState, parseItems, detectPhaseFiles) is unchanged —
          callers don't know which backend was used.
  tests:
    - packages/harness-opencode/test/plan-parser.test.ts::"routes to YAML parser when spec directory exists"
    - packages/harness-opencode/test/plan-parser.test.ts::"falls back to markdown parser when no spec directory"
    - packages/harness-opencode/test/plan-parser.test.ts::"parsePlanState returns identical shape from YAML and markdown"
  verify: cd packages/harness-opencode && bun test test/plan-parser.test.ts

- [x] id: a5
  intent: loop-session uses the spec-writer to mark phases complete (instead
          of regex-replacing checkboxes in main.md). extractSection reads
          goal/constraints from spec/main.yaml when available. Phase detection
          reads the explicit phases array from spec/main.yaml.
  tests:
    - packages/harness-opencode/test/loop-session-yaml.test.ts::"extractSection reads goal from spec/main.yaml"
    - packages/harness-opencode/test/loop-session-yaml.test.ts::"detectPhaseFiles reads phases array from spec/main.yaml"
    - packages/harness-opencode/test/loop-session-yaml.test.ts::"markPhaseChecked updates spec/main.yaml"
    - packages/harness-opencode/test/loop-session-yaml.test.ts::"filterUncheckedPhases uses YAML completed field"
  verify: cd packages/harness-opencode && bun test test/loop-session-yaml.test.ts

- [x] id: a6
  intent: plan-enrichment checks enrichment ratio by inspecting YAML fields
          directly (mirror/context/conventions presence) instead of regex
          counting. Enrichment writes go to spec/*.yaml files.
  tests:
    - packages/harness-opencode/test/plan-enrichment-yaml.test.ts::"computeEnrichmentRatio reads from YAML spec when available"
    - packages/harness-opencode/test/plan-enrichment-yaml.test.ts::"enrichment writes mirror/context/conventions to YAML"
  verify: cd packages/harness-opencode && bun test test/plan-enrichment-yaml.test.ts

- [x] id: a7
  intent: plan-validator validates YAML spec structure (schema check) when
          spec/ exists, falling back to markdown validation otherwise. Errors
          reference YAML field paths, not regex match failures.
  tests:
    - packages/harness-opencode/test/plan-validator-yaml.test.ts::"validates YAML spec structure when spec directory exists"
    - packages/harness-opencode/test/plan-validator-yaml.test.ts::"reports error for missing phases in main.yaml"
    - packages/harness-opencode/test/plan-validator-yaml.test.ts::"reports error for item without intent in phase YAML"
    - packages/harness-opencode/test/plan-validator-yaml.test.ts::"falls back to markdown validation without spec directory"
  verify: cd packages/harness-opencode && bun test test/plan-validator-yaml.test.ts

- [x] id: a8
  intent: changeset-generator and auto-ship read plan title/goal from
          spec/main.yaml when available, falling back to markdown H1/## Goal
          extraction.
  tests:
    - packages/harness-opencode/test/changeset-generator.test.ts::"readPlanGoal reads from spec/main.yaml"
    - packages/harness-opencode/test/changeset-generator.test.ts::"readPlanTitle reads from spec/main.yaml"
    - packages/harness-opencode/test/auto-ship-yaml.test.ts::"readPlanH1 reads title from spec/main.yaml"
  verify: cd packages/harness-opencode && bun test test/changeset-generator.test.ts test/auto-ship-yaml.test.ts

- [x] id: a9
  intent: All existing tests continue to pass unchanged — the markdown
          fallback path is exercised by the existing test suite and no
          regressions are introduced.
  tests:
    - packages/harness-opencode/test/plan-parser.test.ts::"parses single-file plan checkbox state"
    - packages/harness-opencode/test/plan-parser.test.ts::"parses multi-file plan with main.md and phase files"
    - packages/harness-opencode/test/plan-enrichment.test.ts::"computeEnrichmentRatio counts enriched items"
    - packages/harness-opencode/test/plan-validator.test.ts::"validates directory plan with main.md"
  verify: cd packages/harness-opencode && bun test
```

## File-level changes

### packages/harness-opencode/src/autopilot/spec-schema.ts (NEW)
- Change: TypeScript interfaces for YAML schema (`MainSpec`, `PhaseSpec`, `SpecItem`, `SpecFileEntry`) plus runtime validators `validateMainSpec()` / `validatePhaseSpec()` that return structured errors. These types map 1:1 to the YAML structure; the parser converts them to the existing `PlanState`/`PlanItem` types.
- Why: Schema validation catches malformed YAML early with clear messages instead of silent data loss.
- Risk: low

### packages/harness-opencode/src/autopilot/spec-parser.ts (NEW)
- Change: YAML spec parser. Exports `parseSpecState(planDir)`, `parseSpecItems(phasePath)`, `detectSpecPhases(planDir)`, `hasSpec(planDir)`. Reads `spec/main.yaml` and `spec/<phase>.yaml` files via `yaml.parse()`, validates against schema, converts to `PlanState`/`PlanItem[]`/`string[]`.
- Why: Centralizes all YAML reading logic in one place, replacing the scattered regex patterns.
- Risk: low

### packages/harness-opencode/src/autopilot/spec-writer.ts (NEW)
- Change: YAML spec writer. Exports `markItemChecked(planDir, phaseFile, itemId)`, `markPhaseCompleted(planDir, phaseFile)`, `writeEnrichmentFields(planDir, phaseFile, itemId, fields)`. Reads existing YAML, merges updates via `yaml.stringify()`, writes back.
- Why: The autopilot needs to update spec files as items/phases complete and as enrichment runs.
- Risk: low

### packages/harness-opencode/src/autopilot/plan-parser.ts
- Change: Add routing logic at the top of `parsePlanState()`, `parseItems()`, `detectPhaseFiles()`. Import `hasSpec` from `spec-parser.ts`. If `spec/` subdirectory exists, delegate to spec-parser functions; otherwise fall through to existing regex logic (unchanged).
- Why: Transparent fallback — callers don't change, existing plans keep working.
- Risk: low

### packages/harness-opencode/src/autopilot/loop-session.ts
- Change: In `runLoopSession()`, after detecting a directory plan, check for spec via `hasSpec()`. If present: read goal/constraints from `parseSpecState()` result (not `extractSection`), read phases from `detectSpecPhases()` (not regex-based `detectPhaseFiles`), use `spec-writer.markPhaseCompleted()` instead of `markPhaseChecked()` regex replacement. The `runItemsForPhase` inner function uses `spec-writer.markItemChecked()` after item completion. The `filterUncheckedPhases` function checks YAML `completed` field when spec exists.
- Why: Eliminates the most complex regex usage (phase detection, checkbox marking, section extraction).
- Risk: medium — this is the orchestrator; incorrect routing breaks the entire loop.

### packages/harness-opencode/src/autopilot/plan-enrichment.ts
- Change: In `computeEnrichmentRatio()`, when spec files exist, count enrichment by checking YAML field presence (`item.mirror`, `item.context`, `item.conventions`) instead of regex. In `enrichPlanForFastModel()`, write enrichment output to spec YAML files via `spec-writer.writeEnrichmentFields()`.
- Why: Enrichment is currently the most fragile regex user — it counts field markers across multiple formats.
- Risk: low

### packages/harness-opencode/src/autopilot/plan-validator.ts
- Change: In `validatePlan()`, when `spec/` exists, validate YAML schema (required fields, phase file references) via `validateMainSpec()`/`validatePhaseSpec()` instead of regex-based checks. Fall back to existing logic for markdown-only plans.
- Why: YAML schema validation is deterministic and doesn't need format-specific regex patterns.
- Risk: low

### packages/harness-opencode/src/autopilot/changeset-generator.ts
- Change: In `readPlanGoal()` and `readPlanTitle()`, check for `spec/main.yaml` first via `hasSpec()`. If present, read `goal` and `title` fields from parsed YAML. Fall back to markdown regex extraction.
- Why: These functions use regex to extract H1 and ## Goal sections — trivial to replace with YAML field access.
- Risk: none

### packages/harness-opencode/src/autopilot/auto-ship.ts
- Change: In `readPlanH1()`, check for `spec/main.yaml` first via `hasSpec()`. If present, read `title` field. Fall back to markdown H1 regex.
- Why: Same pattern as changeset-generator — trivial YAML field read.
- Risk: none

### packages/harness-opencode/test/spec-parser.test.ts (NEW)
- Change: Unit tests for the YAML spec parser — covers main spec parsing, phase parsing, field extraction, checked state, enrichment fields, and schema validation errors.
- Why: Core new functionality needs thorough coverage.
- Risk: none

### packages/harness-opencode/test/spec-writer.test.ts (NEW)
- Change: Unit tests for the YAML spec writer — covers marking items checked, marking phases completed, writing enrichment fields, and preserving existing data.
- Why: Write operations are the highest-risk part of the migration.
- Risk: none

### packages/harness-opencode/test/loop-session-yaml.test.ts (NEW)
- Change: Integration tests for loop-session's YAML path — covers goal/constraint extraction from YAML, phase detection from YAML, phase completion marking via YAML, unchecked-phase filtering via YAML.
- Why: The orchestrator integration is the most complex change.
- Risk: none

### packages/harness-opencode/test/plan-enrichment-yaml.test.ts (NEW)
- Change: Tests for enrichment ratio computation and enrichment writing via YAML.
- Why: Enrichment has its own format-detection logic that needs coverage.
- Risk: none

### packages/harness-opencode/test/plan-validator-yaml.test.ts (NEW)
- Change: Tests for YAML schema validation path in plan-validator.
- Why: Validation errors must be clear and actionable.
- Risk: none

### packages/harness-opencode/test/auto-ship-yaml.test.ts (NEW)
- Change: Tests for auto-ship reading title from YAML spec.
- Why: Ensures the fallback chain works correctly.
- Risk: none

### packages/harness-opencode/test/plan-parser.test.ts
- Change: Add test cases for the routing logic (spec/ exists → YAML path, no spec/ → markdown path, identical output shape). Existing tests remain unchanged.
- Why: Validates the transparent fallback behavior.
- Risk: none

### packages/harness-opencode/test/changeset-generator.test.ts
- Change: Add test cases for `readPlanGoal` and `readPlanTitle` reading from spec/main.yaml.
- Why: Validates the YAML-first fallback chain in changeset generation.
- Risk: none

## Test plan

- **Unit tests (new):** `spec-parser.test.ts`, `spec-writer.test.ts` — cover the new modules in isolation with synthetic YAML fixtures written to temp directories
- **Integration tests (new):** `loop-session-yaml.test.ts`, `plan-enrichment-yaml.test.ts`, `plan-validator-yaml.test.ts`, `auto-ship-yaml.test.ts` — cover the integration points where existing modules route to YAML
- **Regression tests (existing):** All existing `plan-parser.test.ts`, `plan-enrichment.test.ts`, `plan-validator.test.ts`, `autopilot-ralph.test.ts` tests must continue passing (they exercise the markdown fallback path)
- **Full suite:** `cd packages/harness-opencode && bun test` must exit 0 with no regressions
- **Manual verification:** Create a sample plan directory with `spec/main.yaml` + `spec/wave_0.yaml`, run `parsePlanState()` against it, confirm output matches expected `PlanState` shape

## Out of scope

- Planner/scoper prompt changes to generate `spec/` directories (follow-up: those agents need updated system prompts to emit YAML)
- Removing the markdown parser entirely (it stays as permanent fallback)
- The declarative autopilot config (`.glrs/autopilot.yaml`) — separate plan
- Migration tooling to convert existing markdown plans to YAML specs (could be a future CLI command)
- Changes to the `plan-check` CLI tool in `harness-plugin-opencode` (it operates on plan-state fences which are a different concern)
- The conflict-graph and scope-validator modules — they already consume structured `PlanItem[]` data from the parser, so they need zero changes

## Open questions

- None — the design is fully specified by the grounding discussion. The YAML schema, directory structure, and fallback behavior are all confirmed.
