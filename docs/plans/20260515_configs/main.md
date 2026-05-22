# Declarative Autopilot Configuration

**Created:** 2026-05-15
**Status:** Planning
**Scope:** Make the autopilot workflow fully configurable via `.glrs/autopilot.yaml` so different teams, repos, and plans can customize behavior without code changes.

---

## What exists today

- Hardcoded workflow: enrichment → validation → per-phase loop → verify → checkpoint → changeset → optional ship
- Model routing via `--fast` flag (all-or-nothing: deep vs autopilot-execute tier)
- Enrichment prompt hardcoded in `buildPerFilePrompt` with fixed fields (mirror/context/conventions)
- Subagent model tiers hardcoded in agent registrations at plugin init
- Per-phase server isolation already exists (fresh server per phase)
- Enrichment idempotency check already exists (per-file, field-based)
- Two adapters exist: `opencode` (SDK-based, persistent server) and `claude-code-cli` (execa subprocess per invocation). Adapter selection via `-a` flag, hardcoded defaults in `adapter-factory.ts`

## What this plan adds

- `.glrs/autopilot.yaml` for project-level defaults
- `.glrs/plans/<slug>/autopilot.yaml` for plan-specific overrides
- `.glrs/plan-enrich-strategies/` for named enrichment prompt templates
- ~30 deterministic settings (verify strategy, iteration budgets, hooks, changeset, notifications)
- 3 natural-language settings (enrichment strategy, execution prompt, debrief prompt)
- **Adapter selection** (`adapter: opencode | claude-code-cli`) — replaces hardcoded factory defaults and `-a` flag as the primary configuration surface
- **Adapter-aware model routing**: per-workflow-stage, per-agent, per-phase, full model IDs. Values are interpreted by the selected adapter's model resolver (tier names for OpenCode, model IDs for Claude Code CLI, full model IDs containing `/` pass through for both)
- Enrichment retry with idempotency (kill and restart from top on stall)
- Agent override injection via plugin config hook (OpenCode only — ephemeral, per-server)
- **Adapter-specific config** under `adapters.<name>` for settings that only apply to one adapter (e.g., `adapters.claude_code_cli.skip_permissions`, `adapters.opencode.agents`)

---

## Waves

| Wave | Focus | Risk | File |
|------|-------|------|------|
| 0 | Config parser + schema + resolution (incl. `adapter` field) | Low | [wave_0.md](./wave_0.md) |
| 1 | Enrichment strategies + retry | Medium | [wave_1.md](./wave_1.md) |
| 2 | Adapter-aware model routing + agent overrides + per-adapter config | Medium | [wave_2.md](./wave_2.md) |
| 3 | Deterministic settings (verify, hooks, changeset, notifications) | Low | [wave_3.md](./wave_3.md) |
| 4 | Per-phase overrides + CLI flag merge (incl. `-a` adapter flag) | Low | [wave_4.md](./wave_4.md) |
| 5 | TDD execution model (proof-first, red-green per item) | Medium | [wave_5.md](./wave_5.md) |

---

## Safety invariants

- Missing config file = all defaults. Zero config is the happy path.
- CLI flags always override config (explicit user intent wins).
- Agent overrides are ephemeral — they live and die with the per-phase server. The attended harness never sees them.
- **Adapter-specific config is silently ignored when the selected adapter doesn't support it.** `adapters.opencode.agents` is a no-op when `adapter: claude-code-cli`. No error, no warning — it's valid config that simply doesn't apply.
- Invalid config fails fast with a clear error message listing the bad fields. Never silently ignore.
- Enrichment strategies are read-only templates. The LLM edits plan files, never strategy files.
- Custom agent prompts/permissions are paths relative to repo root. Absolute paths are rejected.
- Hooks run in the repo root with the user's shell. Timeout = verify_timeout. Non-zero exit = hook failure.
- **Model values must be valid for the selected adapter.** OpenCode tier names (`deep`, `mid`, `autopilot-execute`) are invalid for `claude-code-cli`. Full model IDs (containing `/`) are valid for both. Validation catches this at config resolution time.

---

## Example configs

**OpenCode adapter (backward-compatible default):**
```yaml
adapter: opencode
models:
  enrichment: deep
  execution: autopilot-execute
  debrief: deep
```

**Claude Code CLI adapter:**
```yaml
adapter: claude-code-cli
models:
  enrichment: claude-opus-4-7
  execution: claude-haiku-4-5-20251001
  debrief: claude-sonnet-4-6
adapters:
  claude_code_cli:
    skip_permissions: true
```
