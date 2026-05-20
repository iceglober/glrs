# Wave 4 — Per-Phase Overrides + CLI Flag Merge

**Focus:** Per-phase config overrides and the final merge layer where CLI flags take precedence over everything.

---

## Items

- [x] 4.1 **Per-phase config resolution.** Before each phase starts, resolve `config.phases.<phase-name>` and deep-merge it over the base config. The phase name is the filename without `.md` (e.g., `wave_0`). This produces a phase-specific config that `runPhaseInner` uses for model routing, iteration budgets, verify strategy, hooks, and agent overrides.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/config-reader.ts` — add `resolvePhaseConfig(baseConfig, phaseName): AutopilotConfig`
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — call `resolvePhaseConfig` before each phase
  - files (NEW):
    - `packages/harness-opencode/test/phase-config.test.ts`
  - verify: `bun test test/phase-config.test.ts`

- [x] 4.2 **Per-phase agent overrides.** When `config.phases.<phase>.agents` has entries, apply them to the server started for that phase. Since we start a fresh server per phase (or per lane in parallel mode), each phase can have its own agent-to-model mapping. The override injection from wave 2 (item 2.4) already supports this — this item wires the per-phase config into it.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — pass phase-specific agent overrides to server startup
    - `packages/harness-opencode/src/autopilot/loop.ts` — forward agent overrides to `startServer`
  - verify: `bun run build && bun test`

- [x] 4.3 **Per-phase hooks.** Phase-level hooks override plan-level hooks. `phases.wave_0.hooks.post_phase: "cargo test"` replaces the plan-level `hooks.post_phase` for wave_0 only. Other phases still use the plan-level hook.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — use phase-resolved hooks
  - verify: `bun run build && bun test`

- [x] 4.4 **CLI flag precedence.** CLI flags override config fields. Map each flag to its config equivalent:
  - `--adapter NAME` / `-a NAME` → `adapter: NAME`
  - `--fast` → `models.execution: autopilot-execute` (OpenCode) or `models.execution: claude-haiku-4-5-20251001` (Claude Code CLI, resolved by adapter's tier alias mapping)
  - `--parallel N` → `execution_order: parallel` + `parallel_lanes: N`
  - `--ship` → `auto_ship: true`
  - `--resume` → `checkpoint: true` (implicit)
  - `--max-iterations-per-phase N` → `max_iterations_per_phase: N`
  - `--stall-timeout N` → `stall_timeout: N`
  - `--notify URL` → `notify_url: URL`
  
  Apply CLI overrides AFTER config resolution, BEFORE execution. The `--adapter` flag takes highest precedence — it overrides both project and plan-level `adapter` settings.

  - files (MODIFIED):
    - `packages/cli/src/commands/autopilot.ts` — apply CLI overrides to resolved config
    - `packages/cli/src/commands/loop.ts` — same
    - `packages/autopilot/src/config-reader.ts` — add `applyCLIOverrides(config, flags): AutopilotConfig`
  - files (NEW):
    - `packages/autopilot/test/cli-overrides.test.ts`
  - verify: `bun test test/cli-overrides.test.ts`

- [x] 4.5 **Config validation errors.** When the resolved config has invalid values (unknown verify strategy, negative iteration budget, non-existent hook command path, etc.), fail fast with a structured error listing every invalid field. Run validation once after the full merge (plan + project + CLI) so the user sees all problems at once, not one at a time.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/config-reader.ts` — add `validateConfig(config): ValidationResult`
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — call validation after merge, exit on errors
  - files (NEW):
    - `packages/harness-opencode/test/config-validation.test.ts`
  - verify: `bun test test/config-validation.test.ts`

- [x] 4.6 **Documentation.** Write `.glrs/autopilot.yaml.example` with every field documented, grouped by section, with defaults shown in comments. This ships with the plugin (copied to dist) and is referenced by `glrs oc configure` as a starting point.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/autopilot.yaml.example`
  - verify: `bun run build`
