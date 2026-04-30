---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot: inject PILOT_* env vars into setup and verify commands

Pilot setup and per-task verify commands now run with a fixed set of `PILOT_*` env vars plus a default `COMPOSE_PROJECT_NAME` injected by the harness. This lets plan authors isolate per-worktree local infrastructure (docker-compose projects, host ports, named volumes) so parallel and retried pilot worktrees don't collide with each other or with a developer's background dev stack.

Injected vars:

- `PILOT_RUN_ID` — ULID of the current run.
- `PILOT_TASK_ID` — stable task id.
- `PILOT_SLOT_INDEX` — pool slot index (0 in v0.1).
- `PILOT_SLOT_SEQ` — unique sequence `= slot_index * 100 + retry_counter`.
- `PILOT_WORKTREE_DIR` — absolute worktree path.
- `PILOT_PORT_BASE` — opinionated port base `= 10000 + PILOT_SLOT_SEQ * 100`.
- `COMPOSE_PROJECT_NAME` — default `pilot-<runIdShort>-<slotSeq>`, only when unset (user/CI intent preserved).

Plan authors using docker-compose for local infra no longer need to hand-roll slot-unique project names or port offsets. See `src/skills/pilot-planning/rules/setup-authoring.md` (updated) for a worked example.
