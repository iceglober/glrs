---
description: Execute a plan. Runs tests inline and gates completion on QA review.
---

Execute the plan at: $ARGUMENTS

If you are not currently in build mode, instruct the user to switch:
- OpenCode: press Tab to switch to the `build` agent, then re-run this command.
- Claude Code: continue; you will act as the build orchestrator for this turn.

Otherwise, follow the Build agent workflow:
1. Read the plan
2. Confirm understanding (one short paragraph)
3. Execute task by task, marking acceptance criteria [x] as you go
4. Final verification (full test suite, lint, typecheck, git diff vs plan)
5. Delegate to @qa-reviewer
6. If [FAIL], fix each issue and re-verify. No retry limit.
7. On [PASS], report success and the next command: `/ship $ARGUMENTS`
