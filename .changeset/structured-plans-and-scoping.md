---
"@glrs-dev/harness-plugin-opencode": minor
---

Add multi-file structured plan schema, @scoper agent for interactive scoping, and plan-aware progress reporting in the autopilot plugin.

- New `@scoper` primary agent for first-principles alignment before planning
- Multi-file plan schema: `plans/<slug>/main.md` + `phase_N.md` files for complex features
- `plan-parser` module: parses both single-file and multi-file plans, returns structured progress data
- Plan-aware heartbeat: status messages include phase progress for multi-file plans
- `glrs oc autopilot` is now its own interactive subcommand (diverged from `loop`)
- `@plan` agent updated with multi-file decision heuristic
- `@build` agent updated with multi-file plan navigation instructions
- `@plan-reviewer` agent updated with multi-file consistency validation
