---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot-planner: accept multi-issue cross-cutting plans as a first-class shape

The pilot-planning skill previously encouraged the planner to refuse
ambitious multi-issue scopes — pushing users to run multiple pilot
sessions with 3× the setup cost. Skill rework:

- `decomposition.md` gains a "Plan sizing" section: 5–30 tasks is the
  sweet spot, and bundling 2–4 related issues into one plan is first-
  class when they share repo + package manager + docker-compose + test
  runner. Cross-references `dag-shape.md`'s "Disconnected" pattern.
- `SKILL.md` gains a "When to bundle vs. split plans" section placed
  before "When to refuse". The refuse section is rewritten to refuse
  ONLY for underspecified / ambiguous / no-concrete-acceptance work
  (e.g., "refactor auth", "clean up tech debt"), explicitly stating
  plan size, multi-issue scope, and disconnected-subtree shape are
  NOT refusal reasons.
- `self-review.md` question 6 is rewritten: task-level `cascadeFail`
  only blocks DEPENDENTS of the failing task, not siblings in
  disconnected subtrees. The question now asks whether the dependency
  graph concentrates too much value in one critical task (a real
  anti-pattern), not whether the plan is "too big" (a false one).

Observable effect: the planner now bundles cross-cutting work like
"rule-engine cleanup + cache invalidation + admin UI" into one plan
instead of refusing the scope.
