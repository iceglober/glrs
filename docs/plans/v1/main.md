# Autopilot v1 — Production-Grade Autonomous Execution

**Created:** 2026-05-15
**Status:** Planning
**Scope:** Close every known gap in the autopilot subsystem so it can run multi-hour, multi-phase plans reliably without human babysitting.

---

## What exists today (shipped or on-branch)

- Per-phase session execution (fresh context per wave/phase file)
- Plan picker (`-p` flag) and `--plan` path
- `--fast` mode with plan enrichment + dedicated `autopilot-execute` tier
- `glrs oc configure` for model tier management
- Question-tool deadlock fix (skip instead of hang)
- Progress logging (tool calls, iteration summaries, git commits)
- Phase detection for any `.md` naming convention
- Cost accumulation across phases
- Cross-cutting items execution after all phases
- `@debriefer` agent for post-run summaries

## What's broken or missing

### Reliability
- Cost reporting shows $0.00 during iterations (Bedrock doesn't report mid-stream)
- Enrichment session sometimes doesn't complete cleanly
- No retry on transient LLM API errors (session dies on first error)
- No resume from where you left off after a crash/kill
- Stall timeout is 60 minutes — too long for fast models, too short for Opus planning

### Observability
- No notification when autopilot finishes, errors, or stalls (user has to watch terminal)
- No way to check status from another terminal/device
- Debrief only runs after the loop — no mid-run progress summaries
- Tool call logs don't show what file was read/edited (just "tool: read")

### Execution quality
- Plans without per-item `files:` fields cause fast models to explore instead of execute
- No validation that the agent's edits match the plan's file list
- No automatic test running between phases
- No rollback on failed phases (dirty working tree left behind)

### Parallelization
- Phases execute sequentially even when they touch disjoint files
- No mechanism to detect which phases can run in parallel
- Single worktree — can't run two phases simultaneously

### UX
- Scoper asks redundant questions when plan already exists
- No way to skip enrichment if plan is already enriched
- No `--dry-run` to preview what would execute
- Configure command doesn't show which model each agent actually resolves to at runtime

---

## Waves

| Wave | Focus | Risk | File |
|------|-------|------|------|
| 1 | Notifications + observability | Low | [wave_1.md](./wave_1.md) |
| 2 | Execution reliability + resume | Medium | [wave_2.md](./wave_2.md) |
| 3 | Parallel execution | High | [wave_3.md](./wave_3.md) |
| 4 | Execution quality + validation | Medium | [wave_4.md](./wave_4.md) |

---

## Safety invariants

- Never force-push, never push to main/master
- Never run destructive git commands in autopilot mode
- Always preserve uncommitted work on crash (no `git reset --hard` in error paths)
- Notifications must never leak plan content or code to external services
- Parallel execution must never have two sessions editing the same file
