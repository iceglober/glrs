---
"@glrs-dev/harness-plugin-opencode": patch
---

background watchers: teach a vendor-neutral, context-dependent wake rule instead of hardcoding GitHub CLI commands

The `background_run` description, the timer-poll and inline-sleep rejection messages, and both PRIME prompts previously prescribed `gh pr checks --watch` / `gh run watch` — coupling the harness to GitHub Actions and, worse, inviting models to copy the command without reasoning about its semantics (plain `--watch` waits for every parallel check, so an early failure never fires the completion ping).

They now teach the principle: background one self-terminating watcher whose wake condition is the first state you'd actually act on — context-dependent, NOT always full completion (a migration → done; CI with parallel checks → the first failure; a deploy → the first non-pending state). The watcher exits there to hand the agent a turn; once awake it acts or re-arms to keep waiting. The mechanics: the generic `until <wake-check>; do sleep 30; done && <status-cmd>`, or whatever watch mode the tool provides (using its early-stop / fail-fast option when the state of interest can occur before completion). No VCS/CI vendor is named.
