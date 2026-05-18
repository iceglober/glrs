# Extract `@glrs-dev/shared` — shared utilities across the glrs ecosystem

**Created:** 2026-05-16
**Status:** Planning

---

## Problem

Six utility modules (741 lines) are byte-for-byte duplicated between `packages/autopilot/src/lib/` and `packages/harness-opencode/src/lib/`. A seventh module (`plan-paths.ts`, 265 lines) is triplicated across autopilot, harness-opencode, and cli with trivial divergences. Child process invocation uses three different patterns (`promisify(execFile)`, `Bun.spawnSync`, raw `spawn`) across 49 call sites with no shared error handling, timeout, or cancellation logic. Prompt construction follows the same `## Goal\n...\n## Constraints\n...` template in 4+ places with no shared builder.

## Target

A new `packages/shared/` workspace package (`@glrs-dev/shared`, private) that owns:

1. **Shared lib modules** — logger, error classifier, credential refresh, model pricing, slack formatter, webhook notifier
2. **Plan path resolution** — parameterized for `~/.glrs` (primary) and `~/.glorious` (legacy fallback)
3. **Shell execution** — `execa`-based `git()` and `exec()` helpers replacing 49 call sites across 7 files
4. **Prompt utilities** — template loading, `$ARGUMENTS` substitution, phase prompt builder

After extraction, `autopilot`, `harness-opencode`, and `cli` import from `@glrs-dev/shared` instead of maintaining copies. The duplicated `src/lib/` directories in autopilot and harness-opencode are deleted.

## Constraints

- `@glrs-dev/shared` is private (`"private": true`) — never published to npm
- Consumed as raw TypeScript via `"main": "src/index.ts"` (same pattern as autopilot and adapter-opencode)
- Zero runtime dependencies beyond `execa`, `pino`, `yaml` (already in the dependency tree)
- No circular dependencies: shared → (nothing); autopilot → shared; harness-opencode → shared; cli → shared
- All existing tests must pass after the migration
- `execa` replaces `promisify(execFile)` and `Bun.spawnSync` patterns — one API for all shell invocation

## Waves

| Wave | Focus | Risk | File |
|------|-------|------|------|
| 0 | Package scaffold + migrate 6 duplicated lib modules | Low | [wave_0.md](./wave_0.md) |
| 1 | Unify plan-paths.ts + shell execution via execa | Medium | [wave_1.md](./wave_1.md) |
| 2 | Prompt utilities — template loader, phase prompt builder | Low | [wave_2.md](./wave_2.md) |
| 3 | Delete duplicates, update all imports, verify | Medium | [wave_3.md](./wave_3.md) |

## Safety invariants

- Each wave produces a working system — all tests pass at wave boundaries
- No module is deleted until its replacement is imported and tested
- The `execa` migration is opt-in per call site — existing patterns work until explicitly replaced
- Prompt utilities are additive — existing inline prompts keep working, new code uses the builder
