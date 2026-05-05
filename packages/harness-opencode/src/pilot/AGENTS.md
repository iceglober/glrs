# src/pilot — unattended task execution subsystem (cwd mode)

The pilot decomposes a feature into a `pilot.yaml` DAG (planner agent), then executes tasks from the DAG unattended (builder agent) directly in the user's current worktree. The worker loop coordinates opencode sessions and a SQLite state store, committing each task's output on HEAD of the user's feature branch after verify passes.

**No worktree pool. No setup phase. No per-task branch.** The user prepares their own environment (install, compose, migrate, seed) on a feature branch — optionally via a `.glrs/hooks/pilot_setup` script that pilot auto-runs before the task loop — then invokes `pilot build` and walks away.

The root AGENTS.md covers the high-level registration model (rule 10). This file is the drill-down.

## Layout

```
pilot/
├── paths.ts          # ~/.glorious/opencode/<repo>/pilot/* resolution (mirrors plan-paths.ts)
├── plan/             # pilot.yaml schema (zod), loader, DAG builder, globs, slug
│   ├── schema.ts     # PlanSchema, TaskSchema, MilestoneSchema, DefaultsSchema
│   ├── load.ts       # parsePlan()
│   ├── dag.ts        # topological sort + ready-set
│   ├── globs.ts      # picomatch-based touches-scope matching
│   └── slug.ts       # deterministic task-id slugs
├── state/            # SQLite: runs/tasks/events + migrations + accessors
├── opencode/         # opencode server lifecycle, SSE EventBus, builder prompts
├── verify/           # verify-runner (runs verify-command + enforces touches scope)
├── build/            # retry engine: classify, critic, diversify, circuit, retry-strategy, engine
├── worker/           # worker.ts (main loop) + safety-gate.ts + stop-detect.ts
├── scheduler/        # ready-set.ts (which tasks are ready to claim)
└── cli/              # `pilot <verb>` cmd-ts subcommands (see table below)
```

## Per-repo state layout (persistent, NOT under ~/.config/opencode)

```
~/.glorious/opencode/<repo>/pilot/
├── state.sqlite      # runs, tasks, events
└── runs/<run-id>/
    ├── plan.yaml     # frozen copy of pilot.yaml for this run
    └── tasks/<task-id>/
        ├── session.jsonl    # opencode session events
        ├── verify.log       # verify-runner output
        └── status.json
```

`<repo>` derives from `git rev-parse --git-common-dir` → per-repo key, same strategy as `src/plan-paths.ts`.

## Invariants

1. **Builder never commits.** `src/plugins/pilot-plugin.ts` denies `git commit`/`push`/`tag`/`branch`/`checkout`/`switch`/`reset` for the builder session. The worker commits on its behalf after verify succeeds.
2. **Planner only edits plans.** Same plugin denies edit/write/patch/multiedit outside the plans directory for the planner session.
3. **Touches-scope enforced by verify-runner.** Every task declares globs it may modify; verify-runner rejects edits outside scope before advancing.
4. **Pilot runs in the user's current worktree (cwd).** Pre-flight refuses to run on main/master/default-branch or with a dirty tree. Tasks that fail halt the run; the user recovers via `pilot build-resume`. There is no worktree pool, no setup phase, no per-task branch.
5. **The tree is clean between every task.** After every task — success OR failure — the worker guarantees `git status --porcelain` is empty before picking the next task. Success paths commit via `commitAll`; failure paths `git reset --hard HEAD && git clean -fd` (gitignored files preserved). Forensic record of what the failed task did lives in `runs/<runId>/tasks/<taskId>/session.jsonl`, NOT in the working tree. If post-task cleanup itself fails, the run halts — subsequent tasks cannot safely run on a mixed tree.
6. **The plugin is the second fence.** Agent permission maps are the first; don't collapse them into one.

## CLI surface

`pilot` wires into the top-level cmd-ts tree in `src/cli.ts`.

| Verb | Purpose |
|---|---|
| `pilot plan` | Invoke pilot-planner → emit pilot.yaml |
| `pilot build` | Run the worker loop against a pilot.yaml (in cwd) |
| `pilot build-resume` | Continue a partially-completed run from where it left off |
| `pilot validate` | Lint a pilot.yaml without running it |
| `pilot status` | Inspect current run state |
| `pilot logs` | Tail task event log |
| `pilot cost` | Usage accounting |
| `pilot plan-dir` | Print the per-repo plan dir (used by the PRIME's bootstrap probe) |

## Adding a new verb

1. Add `src/pilot/cli/<verb>.ts` exporting a cmd-ts `command(...)`.
2. Register it in `src/pilot/cli/index.ts`'s `pilotSubcommand`.
3. Add a test in `test/pilot-cli-*.test.ts`.
4. State-touching verbs go through `src/pilot/state/` accessors, not inline SQL.

## Spikes

See `docs/pilot/spikes/` (S1-S6) for Phase-0 de-risking notes.

`PILOT_TODO.md` at the repo root tracks the ship checklist.
