---
description: Start a new planning session. Produces a reviewable plan at .agent/plans/<slug>.md.
---

The user wants to plan: $ARGUMENTS

If you are not currently in plan mode, instruct the user to switch:
- OpenCode: press Tab to switch to the `plan` agent, then re-run this command.
- Claude Code: continue; you will act as the plan orchestrator for this turn.

Otherwise, follow the Plan agent workflow:
1. Interview the user (2–4 questions max)
2. Ground in the codebase
3. Delegate to @gap-analyzer
4. Write the plan to .agent/plans/<slug>.md
5. Delegate to @plan-reviewer
6. Iterate until [OKAY]
7. Report the plan path and the next command: `/implement .agent/plans/<slug>.md`
