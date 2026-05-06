# src/pilot — SPEAR-based autonomous execution subsystem (v2)

Pilot v2 implements the SPEAR loop (Scope → Plan → Execute → Assess → Resolve) for autonomous code execution. The user scopes interactively, then `pilot go` runs the rest autonomously.

## Layout

```
pilot/
├── config.ts       # PilotConfig schema, loader, writer (.glrs/pilot.json)
├── paths.ts        # Path resolution (state DB, scope/plan artifacts, current-scope pointer)
├── state.ts        # SQLite state (2 tables: workflows + events), logEvent()
├── safety.ts       # Pre-flight gate (rejects main/master, dirty tree, non-git)
├── server.ts       # OpenCode server lifecycle (start, createSession, sendAndWait)
├── scope.ts        # Scope phase: spawns pilot-scoper TUI, validates scope.json
├── plan.ts         # Plan phase: spawns pilot-planner, validates plan.json
├── execute.ts      # Execute phase: one builder session per task, commits on verify pass
├── assess.ts       # Assess phase: spawns pilot-assessor, evaluates ACs + deployment risks
├── resolve.ts      # Resolve phase: final summary, marks workflow complete
├── orchestrator.ts # SPEAR loop: Plan → Execute → Assess → (re-plan) → Resolve
└── cli/
    ├── index.ts    # Pilot subcommand tree (scope, go, configure, status)
    ├── scope.ts    # `pilot scope "<goal>"` — interactive scoping
    ├── go.ts       # `pilot go` — autonomous execution
    ├── configure.ts # `pilot configure` — interactive config
    └── status.ts   # `pilot status` — workflow status
```

## State layout

```
~/.glorious/opencode/<repo>/pilot/
├── state.sqlite          — workflows + events
├── current-scope.json    — pointer to active scope artifact
└── scopes/
    └── <workflow-id>/
        ├── scope.json    — framing + acceptance criteria
        ├── plan.json     — task list
        └── assessment-cycle-N.json — assessment reports
```

## Invariants

1. **Builder never commits.** `src/plugins/pilot-plugin.ts` denies `git commit`/`push`/`tag`/`branch`/`checkout`/`switch`/`reset` for execute-phase sessions. The orchestrator commits on behalf of the builder after verify passes.
2. **Deployment-risk reflection is in Assess, not Resolve.** The assessor asks the three SPEAR questions (what could break, unexpected consequences, what could go wrong) before scoring ACs. Actionable high-severity risks feed back into the re-plan loop.
3. **Context isolation via subagents.** Each SPEAR phase gets its own OpenCode session. Context flows between phases via JSON artifacts, not session history.
4. **Safety gate is mandatory.** `checkSafety()` runs before any phase that modifies the working tree. Rejects main/master, dirty tree, non-git directories.
5. **Config lives in `.glrs/pilot.json`.** Plans describe *what* to build; config describes *how* the system behaves (models per phase, verify commands, assess cycles, Playwright toggle).

## CLI surface

| Command | Description |
|---|---|
| `pilot scope "<goal>"` | Start a new workflow with interactive scoping |
| `pilot go` | Run autonomous Plan → Execute → Assess → Resolve |
| `pilot configure` | Interactively configure pilot for this repo |
| `pilot status` | Show workflow status from SQLite |
