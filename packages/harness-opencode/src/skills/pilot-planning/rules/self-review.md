# Rule 7 — Self-review

**Before declaring the plan ready, run through this checklist.**

The validator catches schema, DAG, and glob errors. It cannot catch "this verify is too weak" or "this scope is too loose". You can.

## The 7 questions

1. **Is each task right-sized?** Reread each task's prompt. Could the pilot-builder do it in ~20 minutes with the standard `max_turns: 50`? If a task feels like 2 hours of work, split it. If it feels like 2 minutes, merge it.

2. **Does each verify command HAVE to fail before the task runs?** For each task, mentally checkout the pre-task state. Would the verify command fail there? If not, the verify isn't observing the task's effect — fix it. **Also check milestone and defaults verify commands:** mentally walk the DAG in order and confirm that `defaults.verify_after_each` and each milestone's `verify` pass at every task boundary — including right after scaffold tasks that create a test runner config but zero test files. If a broad `test` command would exit 1 on "no test files found", add `--passWithNoTests` (vitest/jest) or equivalent.

3. **Is each `touches:` glob the tightest fit?** For each task, list the files the agent will need to edit. Are they all matched? Are there ANY paths matched that the agent SHOULDN'T touch? If yes to either, refine.

4. **Does the DAG match the actual dependencies?** For each `depends_on:` edge, ask: does the dependent task READ code the dep produces, or assume schema the dep modifies? If "no" to both, the edge is false. Drop it.

5. **Are there missing edges?** Look at every pair of tasks that share files in their `touches:`. Do they need an order? If T2's verify exercises code T1 introduces, T2 depends on T1 — even if their `touches:` don't overlap.

6. **Does the DAG concentrate too much value in one task?** Task-level `cascadeFail` only blocks transitive DEPENDENTS of the failed task — sibling subtrees in a disconnected DAG keep running. So plan size is not itself a risk. The real risk is a task everything else depends on: a schema migration that all downstream work reads, a core-type definition all imports reference, a shared config every consumer parses. If THAT task fails, the whole run stalls. Is there such a task in your plan? If yes, can it be simplified — smaller diff, tighter verify, higher success probability? Don't over-concentrate; a plan where 80% of tasks depend on T1 and T1 is complex is fragile by design.

7. **Could you read this plan in 6 months and understand it?** Plan names + task titles + prompts should be a self-explanatory summary of the work. If the plan needs a verbal preamble to make sense, rewrite the prompts.

## Run validate

```
bunx @glrs-dev/harness-plugin-opencode pilot validate <plan-path>
```

Fix every error AND warning. The "warnings" tier (e.g., glob conflicts between tasks) is also yours to action — either decide they're OK and document it, or restructure.

## When the plan is ready

When all seven questions are answered "yes" and `pilot validate` exits 0:

- Save the plan.
- Tell the user: `Plan saved to <path>. Next: bunx @glrs-dev/harness-plugin-opencode pilot build`.
- Stop. Don't summarize. Don't editorialize. The user can read the YAML.

## When the plan is NOT ready

If you can't answer "yes" to any of the seven questions and you don't see a way to fix it within the planning session:

- Tell the user honestly. "I can't produce a plan that I'd trust the unattended builder to execute, because <specific reason>."
- Suggest the regular `/plan` agent (markdown plans, human-driven `/build`) or a manual decomposition.

It is far better to refuse than to ship a bad plan.
