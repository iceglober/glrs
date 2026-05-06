---
"@glrs-dev/harness-plugin-opencode": major
---

**Pilot v2: SPEAR-based autonomous execution (breaking change)**

Replaces the pilot v1 subsystem (plan-based DAG executor) with a clean SPEAR-based system (Scope → Plan → Execute → Assess → Resolve).

**Breaking changes:**
- `pilot build`, `pilot validate`, `pilot status`, `pilot logs`, `pilot cost`, `pilot build-resume`, `pilot plan` commands removed
- `pilot.yaml` format no longer supported
- Old state DBs under `~/.glorious/opencode/<repo>/pilot/` are orphaned (not migrated)
- `pilot-builder` and `pilot-planner` agents replaced by `pilot-scoper`, `pilot-planner`, `pilot-builder`, `pilot-assessor`

**New commands:**
- `pilot scope "<goal>"` — interactive scoping session (conversational, produces `scope.json`)
- `pilot go` — autonomous execution (Plan → Execute → Assess → Resolve loop)
- `pilot configure` — interactive per-phase model selection and behavior config
- `pilot status` — workflow status from SQLite

**Key improvements:**
- Subagent-per-phase for context isolation (each SPEAR phase gets its own OpenCode session)
- Deployment-risk reflection in Assess phase (what could break, unexpected consequences, what could go wrong) — actionable risks feed back into the re-plan loop
- Simple SQLite state (2 tables: workflows + events) instead of 6-table schema
- Config in `.glrs/pilot.json` (not per-plan YAML) with searchable model selection
- Playwright MCP support in Assess phase for visual verification (optional, graceful degradation)
