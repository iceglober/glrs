---
name: pilot-planning
description: Methodology for producing a pilot.yaml plan that the pilot-builder agent can execute unattended. Use when the pilot-planner agent receives a feature request — covers task decomposition, verify-command design, scope tightness, DAG shape, and self-review. Auto-loaded by the pilot-planner agent.
---

# Pilot Planning Skill

You are producing a `pilot.yaml` plan: a list of tasks the pilot-builder agent can execute one at a time, fully unattended. The cost of a bad plan is high — the builder will fail tasks confusingly, the cascade-fail will block downstream work, and the human pilot operator has to clean up worktrees and re-plan.

A good plan trades a planning-session's worth of patient thought for hours of unsupervised builder time. Take the patient thought.

## Workflow

Apply these nine rules in order. Each rule has its own file in `rules/` for the full text:

1. [`first-principles.md`](rules/first-principles.md) — Frame the task FROM the user's intent, not from a templated checklist. Ask "what does the user actually want done?" before "what files might change?"

2. [`decomposition.md`](rules/decomposition.md) — Break the work into right-sized tasks (10-30 minutes of agent time, ≤3 attempts). Too big = unbounded work; too small = orchestration overhead drowns the value.

3. [`verify-design.md`](rules/verify-design.md) — Each task's `verify:` commands must succeed iff the task is correctly done. No `echo done`. No `test -f file.ts`. Real assertions only.

4. [`touches-scope.md`](rules/touches-scope.md) — `touches:` globs must be the tightest set that lets the task succeed. Default to "specific file paths"; `**` is a smell.

5. [`dag-shape.md`](rules/dag-shape.md) — Tasks depend on each other only when there's a real semantic dependency (B reads what A produces). False dependencies make the run sequential when it could parallel; missing dependencies cause subtle race-on-state bugs.

6. [`milestones.md`](rules/milestones.md) — Optional grouping. Use when several tasks share a "is this batch done?" check (e.g. integration tests after a chunk of unit-test work).

7. [`self-review.md`](rules/self-review.md) — Before declaring the plan ready, run through a 7-question checklist. Find the holes yourself; the validator only catches schema errors. And before declaring "refuse", revisit the bundle-vs-split decision below.

8. [`task-context.md`](rules/task-context.md) — Every non-trivial task carries a `context:` block. Thin plans fail because the builder works each task from scratch with no carry-over; rich context pre-loads what the builder needs to work confidently. Cover outcome, rationale, code pointers, acceptance.

9. [`qa-expectations.md`](rules/qa-expectations.md) — Detect → propose → confirm per-surface verify patterns for UI, API, DB, integration, browser-based component, and CLI surfaces.

## After applying the rules

1. Save the YAML to the path returned by `bunx @glrs-dev/harness-plugin-opencode pilot plan-dir`.
2. Remind the user the plan assumes their dev stack is already running (install, compose, migrate, seed). Plans no longer bootstrap their own environment.
3. Run `bunx @glrs-dev/harness-plugin-opencode pilot validate <path>` and fix every error / warning.
4. Hand off to the user with: `Plan saved to <path>. Next: bunx @glrs-dev/harness-plugin-opencode pilot build`.

Do NOT summarize the plan in chat. The user can read the YAML.

## When to bundle vs. split plans

Multi-issue cross-cutting plans are a first-class pilot shape. When a user's scope spans 2–4 related issues, default to **one plan** covering all of them — as long as they share:

- Same repo (or monorepo).
- Same package manager / install command.
- Same `docker-compose` (or equivalent local-infra) stack.
- Same test runner and verify style.
- Same migrations/seed pipeline.

Bundling amortizes setup cost (install, compose up, migrate, seed — minutes each, paid once per pilot run) across all the work. Tasks from different issues typically form disconnected subtrees in the DAG — see [`dag-shape.md`](rules/dag-shape.md)'s "Disconnected" pattern. Task-level `cascadeFail` only blocks transitive dependents, so a failure in one subtree does NOT cascade into its siblings.

**Split into separate pilot plans when:**

- Issues live in different repositories.
- Issues require fundamentally different setup environments.
- Issues have fundamentally different acceptance shapes (e.g., automated typecheck vs. manual operator playbook).

See [`decomposition.md`](rules/decomposition.md) "Plan sizing — count of tasks" for more.

## When to refuse

Refuse ONLY when the **work itself** is underspecified or ambiguous — no concrete acceptance criteria, no clear "done" condition. Examples that warrant refusal:

- "Make the API better."
- "Refactor auth."
- "Clean up tech debt."

These don't name specific behaviors the pilot-builder can verify. Ask the user to narrow the scope before planning.

**Do NOT refuse for:**

- Plan size (5–30 tasks is fine; even more is fine when the work is well-defined).
- Multi-issue scope (2–4 related issues in one plan is first-class — see "When to bundle" above).
- Disconnected-subtree DAG shape (tasks from different concerns don't need artificial edges).
- Concerns about PR shape (that's a reviewer decision; the pilot run can produce one PR or several).

When you do refuse: tell the user honestly and specifically what's missing. Suggest the regular `/plan` agent (markdown plans, human-driven execution) for ambiguous work that needs human iteration before it's pilotable. It is far better to refuse an unspecified request than to ship a plan full of `echo done` verifies — but narrow what "bad plan" means. Ambitious is not bad; ambiguous is bad.
