# Wave 0 — Config Parser + Schema + Resolution

**Focus:** Parse `.glrs/autopilot.yaml`, validate it, and resolve the three-layer merge (plan-specific > project > defaults). Every subsequent wave depends on this.

---

## Items

- [ ] 0.1 **TypeScript schema definition.** Define `AutopilotConfig` as a fully-typed interface in `src/autopilot/autopilot-config.ts`. Every field is optional (defaults applied at resolution time). Nested types for `adapter`, `models`, `agents`, `enrichment`, `execution`, `hooks`, `phases`, `adapters`. Include JSDoc on every field with the default value.

  Key adapter-related fields:
  - `adapter?: "opencode" | "claude-code-cli"` — which adapter drives the agent. Default: `"opencode"`.
  - `models.enrichment`, `models.execution`, `models.debrief` — values are interpreted by the selected adapter's model resolver (see wave 2). No validation at schema level — the model resolver validates at resolution time.
  - `adapters?.opencode?: { agents?: Record<string, AgentOverride> }` — OpenCode-specific agent overrides.
  - `adapters?.claude_code_cli?: { skip_permissions?: boolean; allowed_tools?: string[] }` — Claude Code CLI-specific settings.

  The `adapters` block is a discriminated namespace: each key corresponds to an adapter name, and only the block matching the active `adapter` value is consumed. Other blocks are valid YAML but ignored at runtime.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/autopilot-config.ts`
    - `packages/harness-opencode/test/autopilot-config.test.ts`
  - verify: `bun test test/autopilot-config.test.ts`

- [x] 0.2 **YAML parser.** Read `.glrs/autopilot.yaml` from a given repo root. Parse with `yaml` (already a transitive dep via opencode) or `js-yaml`. Return `Partial<AutopilotConfig>` or `null` if file doesn't exist. Validate against the schema — reject unknown keys with a clear error listing the bad fields. Never throw on missing file.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/config-reader.ts`
    - `packages/harness-opencode/test/config-reader.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/package.json` — add `yaml` dep if not already present
  - verify: `bun test test/config-reader.test.ts`

- [ ] 0.3 **Plan-specific config resolution.** Given a plan path (e.g., `docs/plans/v2_2/`), derive the slug (`v2_2`) and look for `.glrs/plans/v2_2/autopilot.yaml`. If found, deep-merge it over the project-level config. Resolution order: plan-specific > project > built-in defaults. The merge is field-level (not array-replace): `phases.wave_0.agents.build.model` overrides just that one field, not the entire `phases` block.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/config-reader.ts` — add `resolveConfig(repoRoot, planPath): AutopilotConfig`
  - files (NEW):
    - `packages/harness-opencode/test/config-resolution.test.ts` — fixture-based tests with project + plan configs
  - verify: `bun test test/config-resolution.test.ts`

- [ ] 0.4 **Default config constant.** Export `DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig` with every field populated to its default value. This is the base layer that project and plan configs merge onto. Document each default inline. Key defaults: `adapter: "opencode"`, `models.enrichment: "deep"`, `models.execution: "autopilot-execute"`, `models.debrief: "deep"`. These are OpenCode tier names — when `adapter: "claude-code-cli"`, the adapter factory applies its own model defaults before config resolution (see 0.5).

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-config.ts` — add `DEFAULT_AUTOPILOT_CONFIG`
  - verify: `bun test test/autopilot-config.test.ts`

- [ ] 0.5 **Wire into CLI commands.** At the top of the handler (before enrichment, before validation), call `resolveConfig(cwd, planPath)`. Use `config.adapter` to call `createAdapter(config.adapter)` instead of the hardcoded default. Pass the resolved config through to `enrichPlanForFastModel` and `runInteractiveAutopilot`. For now, only log the resolved config at debug level — subsequent waves consume individual fields.

  The adapter factory (`packages/cli/src/adapter-factory.ts`) reads `config.models` and `config.adapters.<name>` to construct the adapter with the right options. This replaces the current hardcoded model defaults in the factory.

  - files (MODIFIED):
    - `packages/cli/src/commands/autopilot.ts` — call `resolveConfig`, use `config.adapter` for adapter creation
    - `packages/cli/src/commands/loop.ts` — same
    - `packages/cli/src/commands/autopilot-tui.ts` — same
    - `packages/cli/src/adapter-factory.ts` — accept `AutopilotConfig` and read models + adapter-specific settings from it, replacing hardcoded defaults
    - `packages/autopilot/src/plan-enrichment.ts` — accept `config?: AutopilotConfig` param (unused this wave)
    - `packages/autopilot/src/loop-session.ts` — thread `config` through `LoopSessionOptions`
  - verify: `bun run build && bun test`
