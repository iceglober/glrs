# Wave 2 — Prompt utilities

**Focus:** Extract prompt loading and construction patterns into shared utilities. The autopilot's inline prompt building and the harness's `readPrompt()` both follow the same patterns — probe candidate paths for `.md` files, substitute `$ARGUMENTS`, build `## Goal / ## Constraints / ## Phase` blocks.

---

## Items

- [ ] 2.1 **Prompt file resolver.** Create `packages/shared/src/prompt.ts` with:

  ```typescript
  /**
   * Search candidate directories for a prompt file by name.
   * Returns the file contents. Throws if not found in any candidate.
   */
  export function resolvePrompt(name: string, searchDirs: string[]): string;

  /**
   * Substitute template variables in a prompt string.
   * Supports: $ARGUMENTS, $CWD, $PLAN_PATH, $TIMESTAMP.
   * Unknown variables are left as-is.
   */
  export function substituteVars(template: string, vars: Record<string, string>): string;
  ```

  `resolvePrompt` replaces the duplicated try/catch `readFileSync` loops in `autopilot/src/loop.ts` (lines 195-221) and `harness-opencode/src/agents/index.ts` (lines 14-30).

  `substituteVars` replaces the `template.replace("$ARGUMENTS", userPrompt)` pattern.

  - files (NEW): `packages/shared/src/prompt.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`
  - verify: `cd packages/shared && bun test`

- [ ] 2.2 **Phase prompt builder.** Add to `packages/shared/src/prompt.ts`:

  ```typescript
  export interface PhasePromptOpts {
    goal: string;
    constraints: string;
    phaseFile: string;
    phaseContent: string;
    /** Preamble text before the goal section. */
    preamble?: string;
    /** Epilogue text after the phase content. */
    epilogue?: string;
  }

  /**
   * Build a structured prompt for a plan phase.
   * Produces the canonical format:
   *   <preamble>
   *   ## Overall goal
   *   <goal>
   *   ## Constraints
   *   <constraints>
   *   ## Your phase (<phaseFile>)
   *   <phaseContent>
   *   <epilogue>
   */
  export function buildPhasePrompt(opts: PhasePromptOpts): string;
  ```

  This consolidates the 4 inline prompt constructions in `loop-session.ts` (lines 529, 575, 711, 1087).

  - files (MODIFIED): `packages/shared/src/prompt.ts`
  - verify: `cd packages/shared && bun test`

- [ ] 2.3 **Per-item prompt builder.** Add to `packages/shared/src/prompt.ts`:

  ```typescript
  export interface ItemPromptOpts extends PhasePromptOpts {
    itemId: string;
    itemIntent: string;
    itemFiles: string[];
    itemTests: string[];
    itemVerify?: string;
    /** Enrichment context (mirror, context, conventions). */
    enrichment?: { mirror?: string; context?: string; conventions?: string };
  }

  /**
   * Build a tightly-scoped prompt for a single plan item.
   * Used by the per-item fast-executor path.
   */
  export function buildItemPrompt(opts: ItemPromptOpts): string;
  ```

  - files (MODIFIED): `packages/shared/src/prompt.ts`
  - verify: `cd packages/shared && bun test`

- [ ] 2.4 **Tests for prompt utilities.** Test `resolvePrompt` (finds file, throws on missing), `substituteVars` (replaces known vars, leaves unknown), `buildPhasePrompt` (correct section ordering), `buildItemPrompt` (includes enrichment context).

  - files (NEW): `packages/shared/test/prompt.test.ts`
  - verify: `cd packages/shared && bun test`

- [ ] 2.5 **Wire prompt resolver into autopilot.** Update `packages/autopilot/src/loop.ts` `buildFullPrompt()` to use `resolvePrompt()` from shared instead of the inline candidate-path loop.

  - files (MODIFIED): `packages/autopilot/src/loop.ts`
  - verify: `cd packages/autopilot && bun test`

- [ ] 2.6 **Wire prompt resolver into harness-opencode.** Update `packages/harness-opencode/src/agents/index.ts` `readPrompt()` to use `resolvePrompt()` from shared.

  - files (MODIFIED): `packages/harness-opencode/src/agents/index.ts`
  - verify: `cd packages/harness-opencode && bun test`

- [ ] 2.7 **Wire phase prompt builder into loop-session.** Replace the 4 inline prompt constructions in `packages/autopilot/src/loop-session.ts` with `buildPhasePrompt()` / `buildItemPrompt()` calls.

  - files (MODIFIED): `packages/autopilot/src/loop-session.ts`
  - verify: `cd packages/autopilot && bun test`
