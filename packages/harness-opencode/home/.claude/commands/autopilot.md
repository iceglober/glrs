---
description: Self-driving orchestrator run. Accepts a Linear issue ref, a free-form task description, or a question.
---

The user wants autopilot to process: $ARGUMENTS

You are the orchestrator running in autopilot mode. Handle the argument yourself — do NOT ask the user to clarify how to interpret it. Classify and dispatch as follows.

## 1. Classify the argument

Examine `$ARGUMENTS` and pick ONE of these paths:

- **Linear issue reference** (matches `/^[A-Z]+-\d+$/` — e.g. `ENG-1234`, `ICE-42`, `GEN-1114`): use the `linear` MCP to fetch issue details (title, description, project, status, comments). Treat the issue content as the request.
- **Free-form task description** (any natural-language request that isn't a Linear ref): treat the text itself as the request.
- **Question** (starts with what/why/how/when/where/which/who, or ends with `?`): treat as question-only.

If unsure after inspection (e.g., arg looks like a Linear ref but `linear.get_issue` returns 404), fall back to treating it as a free-form description. Do NOT ask the user "did you mean the Linear issue or free-form?" — pick the most likely path.

## 2. Run the orchestrator arc

Once classified, run your normal five-phase workflow (see `.claude/agents/orchestrator.md`):

1. **Intent** — you've already classified via step 1 above; skip redundant classification
2. **Plan** (only if substantial) — interview → ground → `@gap-analyzer` → draft plan → `@plan-reviewer` → iterate to `[OKAY]`. For Linear-originated requests, cite the issue ID in the plan's `## Goal` section.
3. **Execute** — file-by-file changes with lint/test per file, check off acceptance criteria as you go
4. **Verify** — full suite pass + `@qa-reviewer` → iterate to `[PASS]`
5. **Handoff** — report "Done. Run `/ship <plan-path>` when ready." STOP.

## 3. Autopilot guardrails

- The autopilot plugin (`.opencode/plugins/autopilot.ts`) will inject continuation messages if your session goes idle mid-plan. Treat those messages as a "keep going" signal, not a command to restart from scratch.
- The plugin caps at 10 continuation iterations; if you hit the cap, something is stuck — report specifically and ask for help.
- NEVER commit, push, or open a PR. That's the human gate via `/ship`.
- If you detect circular failure (same test fails after the same fix attempted twice), delegate to `@architecture-advisor` before a third attempt.

## 4. Reporting

Your single handoff message should include:
- What was classified (Linear issue ID + title, or the free-form summary, or "question-only")
- Plan path if created
- Summary of changes (1-2 sentences)
- Exact command to ship: `/ship .agent/plans/<slug>.md`

Do not over-narrate across multiple messages. One final report.
