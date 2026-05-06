# Pilot v2 — SPEAR-based rip-and-rebuild

## Goal

Delete the entire existing pilot subsystem (~50 source files, ~41 test files, 3 agent prompts, 1 skill directory, 1 plugin) and replace it with a clean SPEAR-based (Scope → Plan → Execute → Assess → Resolve) autonomous execution system. The new system is simpler, uses subagent-per-phase for context isolation, has a two-command UX (`pilot scope` + `pilot go`), and puts all configuration in `.glrs/pilot.json` via an interactive `pilot configure` command.

## Constraints

- **Semver: this is a major bump.** The CLI surface changes (removal of `pilot build`/`validate`/`status`/`logs`/`cost`/`build-resume`, addition of `pilot scope`/`go`/`configure`). Changeset must be `major`.
- **Top-level `plan-dir` and `plan-check` CLI commands are untouched.** They live in `src/cli.ts` and `src/bin/`, not in `src/pilot/`.
- **`autopilot.ts` plugin is untouched.** It's independent of `src/pilot/`.
- **`plan-paths.ts` is untouched.** No pilot imports.
- **Safety gate must be reimplemented.** The new system must refuse to run on main/master, outside a git repo, or with a dirty tree.
- **Runtime guards must be reimplemented.** The execution subagent must not be able to commit/push/tag/branch. The new `pilot-plugin.ts` enforces this.
- **Playwright MCP is optional with graceful degradation.** If unavailable, Assess skips visual checks.
- **Existing `.glrs/pilot.json` files in user repos will be incompatible.** The new schema is different. Detect old format and warn (don't crash).
- **Old state DBs under `~/.glorious/opencode/<repo>/pilot/` are orphaned.** Don't attempt migration — the schema is completely different. Log a one-time notice if old state is detected.
- **`bun:sqlite` remains as a dependency** (new system uses it for state).
- **`@inquirer/prompts` remains** (used by `pilot configure` and existing `cli/install.ts`).

## Architecture

### SPEAR phases mapped to pilot

```
┌─────────────────────────────────────────────────────────┐
│  pilot scope "<goal>"                                    │
│  ┌─────────┐                                            │
│  │  SCOPE  │  Interactive OpenCode TUI session.          │
│  │         │  Scoping agent interviews user,             │
│  │         │  explores codebase, produces scope.json.    │
│  └────┬────┘                                            │
│       │ scope.json (framing + acceptance criteria)       │
│       ▼                                                  │
│  pilot go                                                │
│  ┌─────────┐                                            │
│  │  PLAN   │  Autonomous. Planner subagent reads scope,  │
│  │         │  surveys repo, produces task DAG.           │
│  │         │  1-2 user feedback cycles (optional).       │
│  └────┬────┘                                            │
│       │ plan.json (ordered task list + verify commands)   │
│       ▼                                                  │
│  ┌─────────┐                                            │
│  │ EXECUTE │  Autonomous. Builder subagent per task.     │
│  │         │  Each task = one OpenCode session.          │
│  │         │  Commits on success.                        │
│  └────┬────┘                                            │
│       │ execution summary artifact                       │
│       ▼                                                  │
│  ┌─────────┐                                            │
│  │ ASSESS  │  Autonomous. QA subagent scores against ACs.│
│  │         │  Shell gates + Playwright (optional) +      │
│  │         │  LLM semantic review.                       │
│  │         │  If FAIL → re-plan gap → re-execute →      │
│  │         │  re-assess (bounded by max_assess_cycles).  │
│  └────┬────┘                                            │
│       │ assessment report                                │
│       ▼                                                  │
│  ┌─────────┐                                            │
│  │ RESOLVE │  Autonomous. Final cleanup, summary,        │
│  │         │  deployment-risk reflection.                │
│  └─────────┘                                            │
└─────────────────────────────────────────────────────────┘
```

### Subagent model

Each phase spawns a dedicated OpenCode session with a phase-specific agent:
- **pilot-scoper** — read-only tools + codebase exploration. Produces `scope.json`.
- **pilot-planner** — read-only tools + plan writing. Produces `plan.json`.
- **pilot-builder** — full edit tools, constrained by runtime guards (no commit/push). One session per task.
- **pilot-assessor** — read-only tools + shell execution + Playwright MCP. Produces assessment report.

Context flows between phases via artifacts (JSON files), not session history. Each session starts fresh with only the relevant artifact as context.

### State model (SQLite)

Two tables:
```sql
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,   -- ULID
  goal        TEXT NOT NULL,
  scope_path  TEXT,               -- path to scope.json
  plan_path   TEXT,               -- path to plan.json
  status      TEXT NOT NULL,      -- pending|scoped|planned|executing|assessing|completed|failed
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  config      TEXT                -- JSON snapshot of .glrs/pilot.json at start
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  phase       TEXT NOT NULL,      -- scope|plan|execute|assess|resolve
  kind        TEXT NOT NULL,      -- e.g. task.execute.started, task.assess.failed
  task_id     TEXT,               -- null for workflow-level events
  payload     TEXT NOT NULL,      -- JSON
  session_id  TEXT                -- OpenCode session ID (for log correlation)
);
```

That's it. No runs, tasks, phases, artifacts, workflows, migrations tables. Two tables.

### Config schema (`.glrs/pilot.json`)

```json
{
  "models": {
    "scope": "anthropic/claude-sonnet-4-6",
    "plan": "anthropic/claude-sonnet-4-6",
    "execute": "anthropic/claude-sonnet-4-6",
    "assess": "anthropic/claude-sonnet-4-6"
  },
  "verify": {
    "baseline": ["bun test", "bun run typecheck"],
    "after_each": ["bun run typecheck"]
  },
  "max_assess_cycles": 3,
  "playwright": {
    "enabled": false,
    "base_url": "http://localhost:3000"
  }
}
```

`pilot configure` walks through each field interactively (model selection is searchable via inquirer's autocomplete).

### Logging format

Structured events emitted to both SQLite and stderr:
```
[pilot] workflow.started          id=01J... goal="Add dark mode"
[pilot] task.scope.started        session=ses_abc
[pilot] task.scope.completed      duration=45s artifacts=scope.json
[pilot] task.plan.started         session=ses_def
[pilot] task.plan.completed       tasks=4 duration=30s
[pilot] task.execute.started      task=1/4 id=ADD-TOGGLE session=ses_ghi
[pilot] task.execute.completed    task=1/4 duration=2m cost=$0.12
[pilot] task.execute.started      task=2/4 id=ADD-STYLES session=ses_jkl
  [pilot] task.execute.subagent   task=2/4 tool=edit path=src/theme.ts
[pilot] task.execute.completed    task=2/4 duration=3m cost=$0.18
[pilot] task.assess.started       session=ses_mno
[pilot] task.assess.risk_check    risks=["localStorage not available in SSR"]
[pilot] task.assess.gate.passed   gate=typecheck
[pilot] task.assess.gate.passed   gate=tests
[pilot] task.assess.gate.failed   gate=ac-002 reason="Toggle doesn't persist"
[pilot] task.assess.failed        unmet=[ac-002] cycle=1/3
[pilot] task.plan.replan          gap="ac-002: toggle state not persisted"
[pilot] task.execute.started      task=5/5 id=FIX-PERSIST session=ses_pqr
[pilot] task.execute.completed    task=5/5 duration=1m cost=$0.08
[pilot] task.assess.started       session=ses_stu cycle=2/3
[pilot] task.assess.passed        all_acs_met=true
[pilot] task.resolve.started
[pilot] task.resolve.completed    acknowledged_risks=1
[pilot] workflow.completed        duration=12m total_cost=$0.58
```

### Deployment-risk reflection (Assess phase)

As part of Assess — before scoring ACs — the assessor asks itself:
1. What could break when this deploys?
2. What unexpected consequences could this change have on existing functionality?
3. What could go wrong?

If any answer surfaces an actionable risk, it becomes an additional AC failure that feeds back into the re-plan loop. Non-actionable risks (acknowledged but not fixable in this scope) are recorded in the assessment report and surfaced in the final Resolve summary.

This means Assess is the single quality gate: both "did we meet the ACs?" and "will this break anything?" are evaluated together, and both can trigger the re-plan → re-execute → re-assess cycle.

### Resolve phase

Resolve is the exit: it reads the assessment report, prints the final workflow summary (what was done, total cost, duration, any acknowledged risks), and closes the workflow in SQLite. No new evaluation happens here.

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: The entire existing pilot subsystem is deleted — all 50 source files
          in src/pilot/, all 41 test files matching test/pilot-*, the 3 agent
          prompt files, the pilot-planning skill directory, and the pilot-plugin.
          The package builds and typechecks cleanly after deletion. All non-pilot
          tests continue to pass.
  tests:
    - packages/harness-opencode/test/agents.test.ts::"returns expected agent count after pilot removal"
    - packages/harness-opencode/test/skills-bundle.test.ts::"skill directories match expected set"
  verify: cd packages/harness-opencode && bun run build && bun run typecheck && bun test

- [x] id: a$1
  intent: pilot configure creates or updates .glrs/pilot.json with per-phase
          model selection (searchable), verify commands, max_assess_cycles, and
          playwright config. Interactive prompts guide the user through each field.
  tests:
    - packages/harness-opencode/test/pilot-configure.test.ts::"writes default config when none exists"
    - packages/harness-opencode/test/pilot-configure.test.ts::"preserves existing values as defaults"
    - packages/harness-opencode/test/pilot-configure.test.ts::"validates model identifiers"
  verify: cd packages/harness-opencode && bun test test/pilot-configure.test.ts

- [x] id: a$1
  intent: pilot scope spawns an OpenCode TUI session with the pilot-scoper agent.
          The scoper interviews the user conversationally, explores the codebase,
          and produces a scope.json artifact containing framing (what + why),
          acceptance criteria (behavioral, verifiable), and non-goals.
  tests:
    - packages/harness-opencode/test/pilot-scope.test.ts::"scope.json schema validates"
    - packages/harness-opencode/test/pilot-scope.test.ts::"scope.json contains framing and acceptance criteria"
  verify: cd packages/harness-opencode && bun test test/pilot-scope.test.ts

- [x] id: a$1
  intent: pilot go reads scope.json and autonomously runs Plan → Execute →
          Assess → Resolve. The Plan phase produces a task list. The Execute
          phase runs one OpenCode session per task and commits on success.
          The Assess phase scores against ACs using shell gates + LLM review.
          If Assess fails, it re-plans the gap and loops (bounded).
  tests:
    - packages/harness-opencode/test/pilot-go.test.ts::"plan phase produces task list from scope"
    - packages/harness-opencode/test/pilot-go.test.ts::"execute phase commits on verify pass"
    - packages/harness-opencode/test/pilot-go.test.ts::"assess phase runs verify commands"
    - packages/harness-opencode/test/pilot-go.test.ts::"assess failure triggers re-plan loop"
    - packages/harness-opencode/test/pilot-go.test.ts::"re-plan loop is bounded by max_assess_cycles"
  verify: cd packages/harness-opencode && bun test test/pilot-go.test.ts

- [x] id: a$1
  intent: Each SPEAR phase uses a dedicated OpenCode session (subagent) for
          context isolation. Context flows between phases via JSON artifacts,
          not session history. Structured events are logged to both SQLite and
          stderr with the documented format showing phase, task, and session.
  tests:
    - packages/harness-opencode/test/pilot-events.test.ts::"events are written to SQLite"
    - packages/harness-opencode/test/pilot-events.test.ts::"events include phase and session_id"
    - packages/harness-opencode/test/pilot-events.test.ts::"stderr output matches structured format"
  verify: cd packages/harness-opencode && bun test test/pilot-events.test.ts

- [x] id: a$1
  intent: Runtime guards prevent the execution subagent from committing, pushing,
          tagging, or branching. The safety gate refuses to run on main/master or
          with a dirty tree. These are enforced by the pilot-plugin at the
          tool.execute.before hook level.
  tests:
    - packages/harness-opencode/test/pilot-guards.test.ts::"denies git commit for builder session"
    - packages/harness-opencode/test/pilot-guards.test.ts::"denies git push for builder session"
    - packages/harness-opencode/test/pilot-guards.test.ts::"safety gate rejects main branch"
    - packages/harness-opencode/test/pilot-guards.test.ts::"safety gate rejects dirty tree"
  verify: cd packages/harness-opencode && bun test test/pilot-guards.test.ts

- [x] id: a$1
  intent: The Assess phase performs deployment-risk reflection — asking what
          could break, what unexpected consequences exist, and what could go
          wrong — before scoring ACs. Actionable risks feed back into the
          re-plan loop. Non-actionable risks appear in the final summary.
  tests:
    - packages/harness-opencode/test/pilot-go.test.ts::"assess phase includes deployment-risk reflection"
    - packages/harness-opencode/test/pilot-go.test.ts::"actionable risk triggers re-plan loop"
  verify: cd packages/harness-opencode && bun test test/pilot-go.test.ts

- [x] id: a$1
  intent: The full package builds, typechecks, and all non-pilot tests pass.
          No regressions in the harness's other functionality (agents, commands,
          skills, plugins, CLI install/doctor).
  tests:
    - packages/harness-opencode/test/agents.test.ts::"all agent tests"
    - packages/harness-opencode/test/skills-bundle.test.ts::"all skill tests"
  verify: cd packages/harness-opencode && bun run build && bun run typecheck && bun test
```

## File-level changes

### Phase 1: Deletion (one atomic commit)

#### DELETE: `packages/harness-opencode/src/pilot/` (entire directory)
- All 50 .ts files across build/, cli/, gates/, mcp/, opencode/, plan/, scheduler/, state/, verify/, worker/
- `AGENTS.md` in the directory
- Risk: high — must update all external references simultaneously

#### DELETE: `packages/harness-opencode/test/pilot-*.test.ts` (41 files)
- All pilot test files
- Risk: none (tests for deleted code)

#### DELETE: `packages/harness-opencode/src/agents/prompts/pilot-builder.md`
#### DELETE: `packages/harness-opencode/src/agents/prompts/pilot-builder.open.md`
#### DELETE: `packages/harness-opencode/src/agents/prompts/pilot-planner.md`
- Risk: none (prompts for deleted agents)

#### DELETE: `packages/harness-opencode/src/skills/pilot-planning/` (entire directory)
- 10 files (SKILL.md + 9 rule files)
- Risk: low — `skills-bundle.test.ts` must be updated

#### DELETE: `packages/harness-opencode/src/plugins/pilot-plugin.ts`
- Risk: medium — `src/index.ts` imports this; must update simultaneously

#### MODIFY: `packages/harness-opencode/src/cli.ts`
- Change: Remove `import { pilotSubcommand }` and the `pilot: pilotSubcommand` entry from the CLI tree
- Why: The old pilot CLI is gone; new commands will be re-added in Phase 2
- Risk: low

#### MODIFY: `packages/harness-opencode/src/index.ts`
- Change: Remove `import pilotPlugin` and its composition into the hook chain
- Why: Old runtime guards are gone; new ones come in Phase 2
- Risk: medium — must not break the plugin's default export

#### MODIFY: `packages/harness-opencode/src/agents/index.ts`
- Change: Remove pilot-builder and pilot-planner agent definitions, prompts, permissions, EXECUTOR_VARIANT_AGENTS entries
- Why: Old agents are gone; new agents come in Phase 2
- Risk: medium — must preserve all non-pilot agents

#### MODIFY: `packages/harness-opencode/src/cli/doctor.ts`
- Change: Remove pilot-builder/pilot-planner agent registration checks
- Why: Old agents no longer exist
- Risk: low

#### MODIFY: `packages/harness-opencode/test/skills-bundle.test.ts`
- Change: Remove assertion for `pilot-planning` skill directory
- Why: Skill is deleted
- Risk: low

#### MODIFY: `packages/harness-opencode/test/agents.test.ts`
- Change: Remove pilot-planner and pilot-builder test cases
- Why: Agents are deleted
- Risk: low

#### MODIFY: `packages/harness-opencode/tsup.config.ts`
- Change: Remove `"pilot/mcp/status-server"` entry point
- Why: MCP status server is deleted
- Risk: low

### Phase 2: New system (incremental commits)

#### NEW: `packages/harness-opencode/src/pilot/config.ts`
- Config schema (Zod), loader, defaults
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/cli/configure.ts`
- Interactive `pilot configure` command using @inquirer/prompts with searchable model selection
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/state.ts`
- SQLite schema (2 tables), open/migrate, event append, workflow CRUD
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/paths.ts`
- Path resolution for state DB, scope artifacts, plan artifacts
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/safety.ts`
- Pre-flight safety gate (refuse main/master, dirty tree, outside git)
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/server.ts`
- OpenCode server lifecycle (start, create session, wait for idle, shutdown)
- Extracted from old `opencode/server.ts` + `opencode/events.ts` but simplified
- Risk: medium — core integration point

#### NEW: `packages/harness-opencode/src/pilot/scope.ts`
- Scope phase orchestrator: spawn scoper session, wait for scope.json artifact
- Risk: medium

#### NEW: `packages/harness-opencode/src/pilot/plan.ts`
- Plan phase orchestrator: spawn planner session with scope.json, produce plan.json
- Risk: medium

#### NEW: `packages/harness-opencode/src/pilot/execute.ts`
- Execute phase orchestrator: iterate tasks, spawn builder session per task, commit on success
- Risk: high — most complex phase

#### NEW: `packages/harness-opencode/src/pilot/assess.ts`
- Assess phase orchestrator: spawn assessor session, run shell gates, optional Playwright, LLM review against ACs
- Risk: high — drives the SPEAR inner loop

#### NEW: `packages/harness-opencode/src/pilot/resolve.ts`
- Resolve phase: deployment-risk reflection, final summary
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/orchestrator.ts`
- Top-level SPEAR loop: Plan → Execute → Assess → (re-plan if fail) → Resolve
- Risk: medium

#### NEW: `packages/harness-opencode/src/pilot/cli/scope.ts`
- `pilot scope "<goal>"` CLI command
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/cli/go.ts`
- `pilot go` CLI command
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/cli/status.ts`
- `pilot status` — simple workflow status from SQLite
- Risk: low

#### NEW: `packages/harness-opencode/src/pilot/cli/index.ts`
- New pilot subcommand tree: scope, go, configure, status
- Risk: low

#### NEW: `packages/harness-opencode/src/agents/prompts/pilot-scoper.md`
- Scoper agent prompt (read-only, conversational, produces scope.json)
- Risk: low

#### NEW: `packages/harness-opencode/src/agents/prompts/pilot-planner.md`
- Planner agent prompt (read-only, produces plan.json from scope)
- Risk: low

#### NEW: `packages/harness-opencode/src/agents/prompts/pilot-builder.md`
- Builder agent prompt (edit tools, constrained, one task at a time)
- Risk: low

#### NEW: `packages/harness-opencode/src/agents/prompts/pilot-assessor.md`
- Assessor agent prompt (read-only + shell + Playwright, scores against ACs)
- Risk: low

#### MODIFY: `packages/harness-opencode/src/agents/index.ts`
- Change: Add new pilot agent definitions (scoper, planner, builder, assessor) with appropriate permissions
- Risk: medium

#### MODIFY: `packages/harness-opencode/src/plugins/pilot-plugin.ts` (NEW — same path, new content)
- Change: Rewrite runtime guards for new agent names (pilot-builder session detection + git deny)
- Risk: medium

#### MODIFY: `packages/harness-opencode/src/index.ts`
- Change: Re-add pilot plugin composition
- Risk: low

#### MODIFY: `packages/harness-opencode/src/cli.ts`
- Change: Re-add `pilot` subcommand tree with new commands
- Risk: low

#### MODIFY: `packages/harness-opencode/src/cli/doctor.ts`
- Change: Add checks for new pilot agents (pilot-scoper, pilot-planner, pilot-builder, pilot-assessor)
- Risk: low

#### NEW: `packages/harness-opencode/test/pilot-configure.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-scope.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-go.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-events.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-guards.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-resolve.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-state.test.ts`
#### NEW: `packages/harness-opencode/test/pilot-safety.test.ts`

## Implementation order

### Step 1: Clean deletion
One commit that deletes everything and fixes all external references. The package must build and typecheck after this commit (with pilot CLI commands simply absent).

### Step 2: Foundation
- `config.ts` + `paths.ts` + `state.ts` + `safety.ts`
- `test/pilot-configure.test.ts` + `test/pilot-state.test.ts` + `test/pilot-safety.test.ts`
- `cli/configure.ts`

### Step 3: Server + agents
- `server.ts` (OpenCode session lifecycle)
- Agent prompts (scoper, planner, builder, assessor)
- Agent registrations in `agents/index.ts`
- `pilot-plugin.ts` (runtime guards)
- `test/pilot-guards.test.ts`

### Step 4: Scope phase
- `scope.ts` + `cli/scope.ts`
- `test/pilot-scope.test.ts`

### Step 5: Plan + Execute + Assess + Resolve
- `plan.ts` + `execute.ts` + `assess.ts` + `resolve.ts` + `orchestrator.ts`
- `cli/go.ts` + `cli/status.ts` + `cli/index.ts`
- Wire into `src/cli.ts`
- `test/pilot-go.test.ts` + `test/pilot-events.test.ts` + `test/pilot-resolve.test.ts`

### Step 6: Polish
- `doctor.ts` updates
- Changeset (major bump)
- Final regression run

## Test plan

- **Unit tests** for each module (config, state, safety, guards)
- **Integration tests** for the orchestrator (mocked OpenCode sessions — inject fake session responses to test the SPEAR loop without real LLM calls)
- **Schema tests** for scope.json and plan.json artifacts (Zod validation)
- **Regression gate**: `bun run build && bun run typecheck && bun test` must pass at every step

## Out of scope

- Migration of old pilot state DBs (orphaned, not migrated)
- The old `pilot.yaml` format (completely replaced by scope.json + plan.json)
- Worktree pool / per-task branches (cwd mode only)
- Multi-worker parallelism (single-threaded execution)
- Cost tracking per-session (deferred — the event log captures session IDs for future correlation)
- `pilot build-resume` equivalent (the SPEAR loop handles retries internally; if the process crashes, `pilot go` re-reads scope.json and restarts from Plan)

## Open questions

- **Plan phase user feedback cycles.** The design says "80% autonomous, 1-2 user feedback cycles." How does the planner solicit feedback? Options: (a) planner produces plan.json, orchestrator pauses and prints "Review plan? [y/n/edit]", (b) planner session is interactive (user can type in the TUI), (c) planner always produces plan autonomously and user reviews only if `--interactive` flag is passed. Recommend (c) for simplicity with (a) as a future enhancement.
- **Scope artifact location.** Where does `scope.json` live? Options: (a) `.glrs/pilot/scopes/<workflow-id>/scope.json` (persistent, queryable), (b) temp file passed between phases (ephemeral). Recommend (a) for debuggability.
- **Plan artifact format.** The old system used `pilot.yaml`. The new system uses `plan.json`. What's the schema? Minimum viable: `{ tasks: [{ id, title, prompt, verify: string[] }] }`. No DAG (sequential execution), no touches (trust the builder), no milestones. Simpler.
- **How does `pilot go` know which scope to use?** Options: (a) always uses the latest scope for this repo, (b) `pilot go --scope <path>`, (c) `pilot scope` prints the path and `pilot go` reads from a well-known location. Recommend (c) — scope writes to `.glrs/pilot/current-scope.json` (symlink or path file).
