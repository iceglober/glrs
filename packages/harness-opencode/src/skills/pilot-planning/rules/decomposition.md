# Rule 2 — Decomposition

**Right-sized tasks: 10-30 minutes of agent time, ≤3 attempts to pass verify.**

A "right-sized" pilot task is one the pilot-builder can complete in a single session within the default `max_turns: 50` budget. Empirically, that's about 10-30 minutes of agent wall time and 1-3 attempts.

## Sizing heuristics

**Too big (split it):**

- The verify command exercises >3 distinct code paths.
- The task touches >5 files.
- The prompt has >10 numbered steps.
- The task says "and also" / "while you're at it" — a sign of conjoined work.

**Too small (merge it):**

- The task touches a single file with <30 lines added/changed.
- The verify command would also pass before the task ran.
- Splitting added a `depends_on` edge that just moves work around.

## Splitting patterns

- **Layer-by-layer**: schema → DB accessors → API → wiring. Each layer has its own tests; each is a task.
- **Read → Write**: T1 = "add a function that returns the data", T2 = "add an endpoint that calls it". T2 depends on T1.
- **Skeleton → Detail**: T1 = "introduce the module structure with stubs", T2-Tn = "fill in each stub with logic+tests". The stubs let downstream tasks parallelize.

## Anti-patterns

- **Refactor as one task.** "Refactor X" is a feature, not a task. Decompose into `extract Y`, `inline Z`, `rename W`, each with its own verify.
- **Setup-only tasks.** "Install lodash" is not a pilot task — the next task can install it as part of its own scope. Avoid tasks that don't deliver an observable check.
- **Cleanup-only tasks.** "Remove dead code". The verify is "tests still pass" — but tests passing was already the contract on the previous task. If there's nothing new to assert, this isn't a task.

## When you can't decompose

If the work genuinely doesn't decompose (e.g., a 200-line algorithm that has to land atomically), it might not be a fit for pilot. Tell the user; they may want to run it as a regular `/build` task instead.

## Plan sizing — count of tasks

Per-task size is covered above. Plan-level size (total task count) is a different dimension and has its own sweet spot: **roughly 5–30 tasks per `pilot.yaml`**. Outside this range:

- **Fewer than 5 tasks:** usually means the work is a single change that doesn't benefit from the pilot harness. Consider `/plan` + `/build` instead.
- **More than 30 tasks:** fine in principle, but at that size the plan probably spans enough distinct concerns that a human reviewer will want it split — not a pilot problem, a PR-shape problem.

### Multi-issue cross-cutting plans are a first-class shape

It is **normal and correct** for a single pilot plan to span 2–4 related issues (Linear tickets, GitHub issues) **when those issues share setup and verify infrastructure** — same repo, same package manager, same `docker-compose`, same test runner, same migrations. Reasons to bundle:

- **Setup amortization.** `pnpm install`, `docker compose up`, `pnpm db:migrate`, seed scripts — each of these is minutes of wall time. Running them once per pilot session vs. once per Linear issue saves hours across a multi-issue push.
- **Context reuse.** The builder learns the codebase through reading during early tasks; that context benefits every subsequent task in the run.
- **Shared acceptance.** Cross-issue integration checks (a milestone-close verify that exercises all three issues' changes together) are natural in one plan, awkward across three runs.

**Reference shape (not a red flag):** rule-engine cleanup + LISTEN/NOTIFY cache invalidation + read-only admin UI landed together in one plan of ~19 tasks across 4 milestones, covering 3 Linear issues. This is the shape pilot is built for.

When bundling, the tasks from different issues typically form **disconnected subtrees** in the DAG (no real semantic dependency between them). That's fine — see [`dag-shape.md`](dag-shape.md)'s "Disconnected" pattern. Task-level `cascadeFail` only blocks transitive dependents, so a failure in one subtree doesn't cascade into the siblings.

### When to split instead of bundle

Split into separate pilot plans when:

- The issues live in **different repositories**.
- The issues require **fundamentally different setup environments** (e.g., one needs Postgres + Temporal, the other needs a headless browser grid — sharing setup is worse than paying the cost twice).
- The issues have **fundamentally different acceptance criteria** (e.g., one is a TypeScript refactor verified via typecheck, the other is an infrastructure change verified via a manual operator playbook — no shared verify makes sense).
