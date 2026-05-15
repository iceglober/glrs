---
"@glrs-dev/harness-plugin-opencode": minor
---

Add `@debriefer` agent and post-run debrief to the autopilot CLI

After the Ralph loop exits (any exit reason — sentinel, struggle, timeout, max-iterations, kill-switch, stall, or error), the CLI now optionally spawns a `@debriefer` agent session that produces a structured five-section summary:

1. **What was accomplished** — files changed, commits made, PRs opened
2. **What wasn't finished** — unchecked plan items
3. **Cost summary** — total USD, iterations completed, exit reason
4. **What to do next** — actionable suggestions based on exit reason
5. **Session artifacts** — log file path, plan file path, session ID

The debrief runs by default. Skip it with `--no-debrief` on the CLI or by setting `GLRS_AUTOPILOT_DEBRIEF=off` in the environment.

The `@debriefer` agent is mid-tier (Sonnet-class), read-only (no file edits, bash limited to git read commands), and never throws — if the debrief session fails, a warning is printed and the CLI exits normally based on the loop result.
