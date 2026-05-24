---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/cli": minor
---

Refactor harness subagent prompts for consistency and register `glrs loop` CLI subcommand.

**Harness prompt refactor:**
- Remove inline SPEAR protocol from prime.md (41% reduction); spear-protocol skill is now the sole canonical source
- Consolidate three identical reviewer permission blocks into one shared `REVIEWER_PERMISSIONS` constant
- Remove UI evaluation ladder from plan-reviewer and gap-analyzer (neither verifies web UI)
- Remove repo-specific assumptions from docs-maintainer prompt
- Fix broken bash snippet reference in scoper.md (was a placeholder, now the actual snippet)
- Fix circular self-reference in plan.md defensive posture section
- Standardize question-tool phrasing across all utility agents
- Clean up research.md self-reference and redundant invocation docs
- Update test assertions to match refactored content

**CLI:**
- Register `glrs loop` as a top-level subcommand (was defined but never routed)
- Add `glrs autopilot` and `glrs loop` to help text
