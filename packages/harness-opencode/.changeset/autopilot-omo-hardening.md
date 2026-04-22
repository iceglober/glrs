---
"@glrs-dev/harness-opencode": minor
---

Harden the autopilot loop against the class of bug where it pressures the orchestrator into user-defying behavior. Introduces the **continuation-guard**: a per-session terminal-exit latch (`exited_reason`) fronted by a single short-circuit at the top of the idle handler, with five independent detectors that can fire it.

**The five detectors:**

- **shipped-probe** — `git merge-base --is-ancestor HEAD origin/main` then `gh pr list --head <branch> --state merged`. Detects when the underlying work has already landed via a different branch / merged PR. Cached 60 s per session; 2 s `AbortController` timeout per subprocess; ENOENT / timeout / invalid JSON collapse to `"unknown"`. Originally motivated by a session where the loop kept firing "Plan has 22 unchecked acceptance criteria" nudges *after* the work shipped, pressuring the orchestrator into ticking checkboxes on a stale local file to silence the plugin.
- **user-stop** — `chat.message` handler scans the latest user message for explicit stop signals: uppercase bare `STOP` / `HALT`, plus case-insensitive phrases `stop autopilot` / `kill autopilot` / `disable autopilot` / `exit autopilot`. User-stop always wins.
- **orchestrator-EXIT sentinel** — `<autopilot>EXIT</autopilot>` on its own line, emitted by the orchestrator when it recognizes the loop is wrong. Cooperative self-cancel. Detected by `AUTOPILOT_EXIT_RE`; wins over `<promise>DONE</promise>` when both appear.
- **max-iterations** — 20-iteration budget. Funneled through the same exit latch so subsequent idles don't silently re-enter the legacy nudge branch at iteration 0 (a subtle re-entry bug in the prior implementation).
- **stagnation** — snapshots the substrate (`git rev-parse HEAD` ⊕ `git status --porcelain`) on each idle. If the substrate hash is unchanged across 5 consecutive nudges, exits with `"stagnation"`. Catches the failure mode that shipped-probe misses (loop firing but nothing landing on disk) and that plan-checkbox-counting misses (boxes ticked without code changing). Snapshot failure (no git, not a repo, timeout) resets the counter rather than accumulating false stagnation evidence.

The `/autopilot` slash-command prompt gains **Rule 9 — Autopilot exit**, teaching the orchestrator to emit `<autopilot>EXIT</autopilot>` when the loop is wrong (plan targets shipped work, user said stop, or the nudge is pressuring a scope violation) — rather than rationalizing "it's just a local gitignored file, ticking boxes is reversible" to silence the plugin.

**Naming:** the original draft borrowed the omo marketing term "IntentGate" for this work. After researching the actual omo source (the term turns out to have no implementation behind it; omo's real hooks are `todo-continuation-enforcer` and `stop-continuation-guard`), this PR uses the indigenous **continuation-guard** vocabulary throughout — matching omo's documented `-guard` suffix convention and our codebase's existing hyphenated-plain-English style (`target-agent guard`, `fresh-transition`, `Phase 0: Bootstrap probe`).

No migration required — the new `exited_reason`, `last_shipped_check_at`, `last_shipped_check_result`, `last_substrate_hash`, and `consecutive_stagnant_iterations` fields are optional additions to `SessionAutopilot`. Existing `.agent/autopilot-state.json` files continue to work unchanged. `/fresh` re-keys clear all five fields so a new task starts from a clean slate even after a terminal exit.
