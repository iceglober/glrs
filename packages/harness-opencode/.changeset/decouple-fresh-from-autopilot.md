---
"@glrs-dev/harness-opencode": minor
---

Decouple `/fresh` from the autopilot plugin. `/fresh` is now a pure workspace-cleanup command — parse args, clean the tree, create the branch, optionally dispatch to the repo's `.glorious/hooks/fresh-reset`, then continue inline into the orchestrator on the new task. It no longer writes a handoff brief, no longer touches `.agent/autopilot-state.json`, and no longer coordinates with the autopilot plugin in any way.

This is the architectural fix for the class of "duplicate autopilot nudge" bug where the plugin's `[autopilot] /fresh re-keyed this worktree to a new task...` message fired twice per session — once legitimately after `/fresh`, and once spuriously after the user had already shipped a PR. The `lastNudgedHandoffMtime` idempotency gate (briefly shipped on a dev branch but never released) was hardening code that shouldn't have existed in the first place.

**Deleted from the plugin (`src/plugins/autopilot.ts`):**

- `lastHandoffMtime` field on `SessionAutopilot` and its 14 preservation sites across every state-write path
- `HANDOFF_PATH` constant and `getHandoffMtime` helper
- Signal 2 (fresh-handoff transition) in `detectActivation` — the function is now a one-line first-user-message scan for the `/autopilot` marker
- The fresh-transition branch in the `session.idle` handler (~40 lines, including the nudge body that referenced `.agent/fresh-handoff.md`)
- The first-time-seed branch that populated `lastHandoffMtime` from the brief's mtime on first idle
- Exit-message `/fresh` references — shipped-exit, user-stop, and stagnation messages now direct the user to open a new session and invoke `/autopilot` instead of suggesting `/fresh` as a re-enable path

**Deleted from the `/fresh` prompt (`src/commands/prompts/fresh.md`):**

- §6 "Write the handoff brief" — the entire markdown template, atomic-write semantics, brief-archival-to-tmp fallback
- §6a "Reset autopilot state" — the `jq` rewrite of `.agent/autopilot-state.json`, the fallback-to-empty-sessions path, the whole rationale about iteration counters
- The "read the brief you just wrote" circular step in the orchestrator-kickoff section (§7, formerly §8)
- Every mention of `.agent/fresh-handoff.md`, `handoff brief`, and `autopilot-state.json` across the failure-mode table, the `/autopilot` integration section, and the philosophy statement

Sections renumbered: old §7 (summary) is now §6; old §8 (orchestrator kickoff) is now §7. `RESET_STATUS` labels now go into the summary instead of the brief. The orchestrator-kickoff step uses the user's original input directly (no brief to re-read).

**Deleted from the `/autopilot` prompt (`src/commands/prompts/autopilot.md`):**

- Step 3 of the sequence loop no longer claims `/fresh` writes a brief or resets autopilot state — it now accurately describes `/fresh` as "re-key the worktree and auto-continue into the orchestrator"
- Step 4 no longer references "the autopilot plugin's continuation nudges now reference the fresh handoff brief" — there are no such nudges

**Deleted from tests (`test/autopilot-plugin.test.js`, `test/fresh-prompt.test.ts`):**

- 5 obsolete `detectActivation` tests exercising Signal 2 (fresh-handoff activation)
- 1 obsolete `session.idle` integration test for the fresh-transition nudge
- 1 obsolete "fresh-transition after shipped-exit" regression test
- 2 obsolete handoff-brief-field assertions in the /fresh prompt contract
- `lastHandoffMtime` preservation assertions in chat.message tests

**Added:**

- 2 new /fresh prompt assertions that fail if the coupling is reintroduced: no reference to `.agent/fresh-handoff.md`, and no reference to `.agent/autopilot-state.json`

**Behavior change for users:**

- `/fresh` is faster and simpler — one less file write, no jq invocation, no autopilot coordination.
- The autopilot plugin activates ONLY via explicit `/autopilot` invocation. The fresh-handoff activation path is gone. Users who want autopilot run `/autopilot`; users who want a clean workspace run `/fresh`; the two commands are orthogonal.
- `/autopilot` sequence mode continues to work — its per-iteration loop already drives everything inline: pop ref → `/fresh --yes <ref>` → orchestrator runs on the new ref → loop. No plugin-mediated handoff was ever actually needed.
- Terminal exits from autopilot (shipped, user-stop, orchestrator EXIT, max-iter, stagnation) are now truly terminal for the current session. Users open a new session and invoke `/autopilot` to resume — previously the messaging mentioned `/fresh` as a re-enable path, which was misleading (post-#60 `/fresh` would auto-continue into the orchestrator, not the autopilot arc).

**Backward compatibility:**

- State files written by older versions with `lastHandoffMtime` keys are still readable — the field is simply ignored (JSON.parse tolerates unknown keys, TypeScript-level shape is structural).
- Existing handoff-brief files at `.agent/fresh-handoff.md` are left untouched by the new `/fresh`. They're orphaned documentation, safe to delete manually.
- No migration required.

Minor bump because the autopilot plugin's activation contract is narrowing (Signal 2 removed). Users who were relying on fresh-handoff-based activation (e.g., a hypothetical `/plan-loop` skill writing the brief as a cross-session signal) would break — but `/plan-loop` does not exist in this repo; the activation path existed only in plugin comments. Patch-adjacent in practice, but the contract narrowing deserves explicit signaling.

Net diff: −346 lines across plugin, prompts, and tests. Removes a bug class, not just a bug.
