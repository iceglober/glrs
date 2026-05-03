# Pilot Redesign — Implementation Todo

End-to-end checklist for the multi-phase redesign of pilot. Architecture
locked in [`/root/.claude/plans/re-design-the-opencode-pilot-rosy-puffin.md`](../../).
Every box must be checked before declaring the redesign done.

**Combined release scope:** five-phase workflow (scope → plan → build → qa →
followup), polymorphic Gate abstraction (shell + llm + approval + composite),
self-healing build retry engine, AC-validated QA with auto-recovery,
auto-promote followups for AC-derived findings.

**Decisions baked in (from ADR §10):**
- Scope is the only proactive human touchpoint; single-CLI-session
  prompt-driven approval loop.
- Strict-for-ACs auto-recovery on QA fail (bounded by
  `defaults.max_qa_recovery_cycles`); lenient (human triage) for
  quality/regression findings.
- Plan format gains `context:` + `contract:` per task so smaller executor
  models (Qwen3-Coder, Kimi K2, DeepSeek V3) become viable.
- Gate abstraction is polymorphic; shell/llm/approval/composite all emit
  identically-shaped `task.gate.passed` / `task.gate.failed` events.
- Public CLI keeps `--run` as an alias for `--workflow`; no churn.
- Default executor model stays at frontier in step 5; flip after
  `plan.task_self_containment` confidence is established.

---

## Step 1 — Gate abstraction + shim

Introduce `Gate` types and `evalGate`; rewrite today's `runVerify` as
`evalGate({kind:"shell"})`. Zero behavior change; events get richer payloads.

- [x] Define `Gate` discriminated union (`shell` | `all` | `any`), `GateResult`,
      `ShellEvidence`, `CompositeEvidence`, type guards in
      `src/pilot/gates/types.ts`.
- [x] `src/pilot/gates/shell.ts` — `evalShellGate` over the existing spawn
      primitives.
- [x] `src/pilot/gates/composite.ts` — `evalAllGate` (short-circuit on first
      fail) and `evalAnyGate` (short-circuit on first pass; empty fails).
- [x] `src/pilot/gates/eval.ts` — dispatcher routing on `gate.kind`.
- [x] `src/pilot/gates/index.ts` — barrel export.
- [x] Extract spawn primitives from `verify/runner.ts` into
      `verify/spawn.ts` to break the import cycle that delegation creates.
- [x] Rewrite `verify/runner.ts:runVerify` as a thin shim that builds an
      `all` gate of shell sub-gates, calls `evalGate`, translates the result
      back to the legacy `RunVerifyResult` shape (zero behavior change at the
      worker call site).
- [x] Enrich worker verify event payloads
      (`task.baseline.passed/failed`, `task.verify.passed/failed`) with an
      additive `gate` discriminator. Future LLM/approval gates emit
      identically-shaped events with different `gate.kind`.
- [x] `test/pilot-gates.test.ts` — 21 tests: shell pass/fail/timeout/abort,
      all/any composite (incl. short-circuit, empty-degenerate), nested
      composites, runVerify back-compat through the shim, evidence type
      guards.
- [x] **Verify:** `bun test packages/harness-opencode` shows +21 passing
      tests with identical pre-existing failure set; legacy 24 verify-runner
      tests pass byte-identically; typecheck noise reduced (not increased).
- [x] Commit and push (`3134492`).

---

## Step 2 — State migration

Add `workflows` / `phases` / `artifacts` tables alongside the existing
`runs` / `tasks` / `events`. Backfill existing `runs` rows into a
synthetic single-build-phase shape so all CLI tools keep working.

- [ ] Read `src/pilot/state/{runs,tasks,events}.ts` to map current schema and
      accessor surface.
- [ ] Add `workflows` table: `(id, goal, started_at, finished_at, status,
      current_phase)`. The `id` is the existing run id (no rename) for
      migration ergonomics; ULID continues to be the primary key.
- [ ] Add `phases` table: `(workflow_id, name, status, started_at,
      finished_at, artifact_path)`. `name` is a check-constrained enum
      `scope|plan|build|qa|followup`.
- [ ] Add `artifacts` table: `(workflow_id, phase, kind, path, created_at,
      sha256)`.
- [ ] Add `phase` column to `events` table (NULL for legacy rows). Backfill
      to `'build'` for any existing rows.
- [ ] Migration script: every existing `runs` row gets a paired
      `workflows` row (same id, `goal` derived from `plan_slug`,
      `current_phase = 'build'`) plus a synthetic `phases` row
      (`name = 'build'`, `status` mirrored from `runs.status`,
      `artifact_path` empty for legacy).
- [ ] New accessors in `src/pilot/state/workflows.ts` and
      `src/pilot/state/phases.ts` and `src/pilot/state/artifacts.ts`.
- [ ] Keep existing `runs.ts` accessors working as compatibility wrappers;
      mark with `@deprecated` JSDoc.
- [ ] Test file `test/pilot-state-migration.test.ts`: fresh-DB schema check,
      backfill against a fixture v1 DB, idempotency (running the migration
      twice is a no-op).
- [ ] Test file `test/pilot-state-workflows.test.ts`: workflow CRUD, phase
      transitions, artifact recording, sha256 verification.
- [ ] **Verify:** `pilot status --run <oldRunId>` (against a migrated DB)
      renders the same output as pre-migration. No regression in existing
      `pilot-state-db.test.ts` and `pilot-state-accessors.test.ts`.
- [ ] Commit and push.

---

## Step 3 — Build-phase retry engine

The big self-healing win. Failure classification + critic + diversify +
circuit breakers, behind defaulted plan flags so existing pilot.yaml plans
keep their behavior.

- [ ] Create `src/pilot/build/` directory; move worker internals here over
      the course of this step (worker.ts shrinks to a thin orchestrator).
- [ ] `src/pilot/build/classify.ts` — `classifyFailure(verifyResult,
      context) → FailureClass` (`transient` | `environmental` | `logical` |
      `plan-divergent` | `budget`). Heuristics first; Haiku fallback for
      ambiguous cases.
- [ ] `src/pilot/build/critic.ts` — `runCritic(taskCtx, lastFailure) →
      CriticReport`. Haiku-based LLM gate that returns a structured
      `{ smallestFix, narrowScope, riskFlags }`. Emits
      `task.critic.report` event with `gate.kind === "llm"`.
- [ ] `src/pilot/build/diversify.ts` — strategy ladder
      (`same → critic → narrow-scope → model-swap → fresh-subagent`) keyed
      off `defaults.diversify`. Emits `task.diversify.applied`.
- [ ] `src/pilot/build/circuit.ts` — circuit breakers: cumulative cost cap,
      wall-time cap, signature-recurrence detector. Emits
      `task.circuit.tripped`.
- [ ] `src/pilot/build/retry-strategy.ts` — `keep` vs `reset` semantics for
      inter-attempt tree state. `keep` preserves partial work on a
      `pilot-attempt/<workflowId>/<taskId>` scratch branch.
- [ ] `src/pilot/build/engine.ts` — per-attempt orchestrator replacing the
      body of today's `runOneTaskImpl`. Routes failures through classify →
      critic → diversify → retry-strategy.
- [ ] Extend `pilot/plan/schema.ts` with additive defaulted fields:
      `defaults.critic_model` (default `"anthropic/claude-haiku-4-5"`),
      `defaults.reflexion: boolean` (default `true`),
      `defaults.diversify: "none" | "standard" | "aggressive"` (default
      `"standard"`), `defaults.retry_strategy: "keep" | "reset"` (default
      `"reset"`), `defaults.max_total_cost_usd` (default 20),
      `defaults.max_run_wall_ms` (default 4h),
      `task.max_wall_ms?`, `task.alt_model?`.
- [ ] Update `pilot/opencode/prompts.ts` `fixPrompt` to take the new
      `LastFailure` shape (with critic report and narrow-scope fields).
- [ ] Test files: `test/pilot-build-classify.test.ts`,
      `test/pilot-build-critic.test.ts`, `test/pilot-build-diversify.test.ts`,
      `test/pilot-build-circuit.test.ts`,
      `test/pilot-build-retry-strategy.test.ts`,
      `test/pilot-build-engine.test.ts`. Each module is small, pure-where-
      possible, unit-testable without spinning up opencode.
- [ ] **Verify:** a fixture plan with deliberately-flaky verify (random
      ECONNRESET, missing tool, real bug) demonstrates that classify routes
      each correctly and that circuit breakers trip as configured. Manual
      smoke against a small real repo. Existing `pilot-worker.test.ts`
      passes with defaults preserved.
- [ ] Commit and push.

---

## Step 4 — Scope phase

Turn a vague user intent into (a) a tight framing the user signs off on,
and (b) acceptance criteria the user signs off on. The only proactive
human touchpoint in the workflow.

- [ ] Extend `Gate` union with `approval` kind:
      `{ kind: "approval"; artifact: ArtifactRef; promptToUser: string }`.
      Update dispatcher and types.
- [ ] `src/pilot/gates/approval.ts` — `evalApprovalGate` blocks on
      interactive CLI prompt (`[a]pprove / [e]dit / [d]iscovery / [c]omment`).
      Records artifact sha256 at approval time. Emits `phase.gate.passed`
      with `payload.gate.kind === "approval"` and
      `payload.approvedBy: "user" | "auto-promotion"`.
- [ ] `src/pilot/scope/` directory with:
  - [ ] `agent.ts` — `pilot-scoper` agent definition (read-only tool set:
        file reads, `rg`, `git log`, optional web fetch; no shell, no edits).
  - [ ] `framing.ts` — drives the framing-loop; produces
        `scope/framing.md` (≤50 lines).
  - [ ] `discovery.ts` — drives optional discovery turns; appends to
        `scope/discovery.md`.
  - [ ] `requirements.ts` — drives the requirements-loop; produces
        `scope/acceptance-criteria.md` with `AC-001`-style stable IDs.
  - [ ] `cli-loop.ts` — interactive CLI session (`[a]pprove / [e]dit /
        [d]iscovery / [c]omment`). `[e]` opens `$EDITOR`, scoper picks up
        edits. `[c]` collects free-text feedback.
  - [ ] `artifact.ts` — derives the final `scope/scope.json` from the three
        sub-artifacts. Includes `goal`, `framingPath`, `framingApprovedAt`,
        `discoveryPath`, `acceptanceCriteria`, `acceptanceCriteriaApprovedAt`,
        `nonGoals`, `impactAreasObserved`. No `suggestedTouches` /
        `suggestedVerify` / `recommendedTaskShape` (those are planner
        concerns).
- [ ] Scope-phase gates:
  - [ ] `scope.framing.length` — framing.md ≤ 50 lines.
  - [ ] `scope.framing.approved` — approval gate.
  - [ ] `scope.requirements.shape` — LLM gate; each AC is behavioral and
        verifiable, not file-level.
  - [ ] `scope.requirements.approved` — approval gate.
  - [ ] `scope.coverage` — LLM gate; AC list plausibly covers the framed
        intent. Failure triggers a discovery-loop, not hard halt.
- [ ] CLI: `pilot scope "<goal>"` and `pilot scope resume <id>` (resume is a
      ctrl-c fallback, not a primary affordance).
- [ ] Test files:
  - [ ] `test/pilot-scope-framing.test.ts` (against fake scoper client).
  - [ ] `test/pilot-scope-requirements.test.ts`.
  - [ ] `test/pilot-scope-cli-loop.test.ts` (drives the prompt loop with
        scripted user input).
  - [ ] `test/pilot-gates-approval.test.ts`.
- [ ] **Verify:** `pilot scope "<goal>"` against a sample repo produces a
      framing ≤50 lines, an AC list of behavioral statements, and gate-
      passed approval events. Inspecting `scope/scope.json` shows the
      expected schema.
- [ ] Commit and push.

---

## Step 5 — Plan phase rewire

Autonomous `pilot-planner` agent. Plan output gains `addresses:` /
`context:` / `contract:` fields so smaller executor models can run tasks.

- [ ] Extend `pilot/plan/schema.ts`:
  - [ ] Top-level `scopeRef: <workflowId>`.
  - [ ] Per-task `addresses: [<acId>]`.
  - [ ] Per-task `context: string` (self-contained briefing — existing
        patterns to follow, code excerpts, things not to modify).
  - [ ] Per-task `contract: string` (exact behavioral requirement).
  - [ ] `defaults.executor_model` (initial default stays at frontier per
        ADR §10.1).
- [ ] `src/pilot/plan/planner.ts` — autonomous `pilot-planner` agent
      session. Re-reads scope, surveys repo, decomposes ACs into a tightly-
      scoped task DAG.
- [ ] `src/pilot/plan/agent.ts` — `pilot-planner` agent definition.
- [ ] Plan-phase gates:
  - [ ] `plan.schema` — Zod parse + DAG + globs (existing logic).
  - [ ] `plan.ac_coverage` (LLM gate) — every scope AC is `addresses:`-
        referenced by at least one task.
  - [ ] `plan.task_self_containment` (LLM gate) — for each task, does its
        `context:` + `contract:` give a small executor enough to do the
        work without further repo survey?
  - [ ] `plan.gates_well_formed` — every task declares at least one gate;
        baseline gates pass on the clean tree.
  - [ ] `plan.no_scope_drift` (LLM gate) — no task addresses an AC outside
        the scope artifact, no task introduces work the framing's non-goals
        excluded.
- [ ] Auto-regeneration: failed plan gate triggers up to N (default 2)
      regeneration passes, with the gate's `reason` fed back as planner
      input. Halt + surface to user only after exhaustion.
- [ ] Migration shim: legacy `verify: string[]` translates to
      `gates: [{ kind: "all", gates: [...shell] }]`. Existing pilot.yaml
      plans without `addresses` / `context` / `contract` keep working with
      synthesized stubs (older builds run with frontier executor).
- [ ] CLI: `pilot plan --workflow <id>` (autonomous) and
      `pilot plan --interactive` (opt-in human review).
- [ ] Test files:
  - [ ] `test/pilot-plan-planner.test.ts` (against fake planner client).
  - [ ] `test/pilot-plan-gates.test.ts` (each gate with pass + fail
        fixtures).
  - [ ] `test/pilot-plan-regeneration.test.ts`.
  - [ ] Extend `test/pilot-plan-schema.test.ts` with the new fields.
- [ ] **Verify:** `pilot plan --workflow <id>` autonomously produces a plan
      whose `plan.ac_coverage` and `plan.task_self_containment` gates pass
      on first or second attempt against three sample scope artifacts.
- [ ] Commit and push.

---

## Step 6 — QA phase

Validate the cumulative work against the approved acceptance criteria.
AC-strict auto-recovery on fail; quality/regression findings stay
informational.

- [ ] `src/pilot/qa/` directory with:
  - [ ] `agent.ts` — `pilot-qa` agent definition. Read access to repo at
        new HEAD; reads scope + plan + diff + build event log summary.
  - [ ] `evaluate.ts` — for each AC, picks verification strategy by
        `verifiable` tag (`shell` → derive shell gate; `llm` → LLM gate
        over diff; `manual` → defer-to-user).
  - [ ] `findings.ts` — collects regression and quality findings (severity-
        tagged).
  - [ ] `artifact.ts` — produces `qa/qa.json` and `qa/qa.md`.
  - [ ] `recovery.ts` — AC-strict auto-recovery driver. Bounded by
        `defaults.max_qa_recovery_cycles` (default 2). Re-invokes planner
        with only unmet/partial ACs + QA evidence, runs build → qa, repeats.
        Emits `phase.qa.recovery.started` / `phase.qa.recovery.exhausted`.
- [ ] QA gates:
  - [ ] `qa.ac_met` — every AC is `met` or explicitly `deferred-to-user`.
  - [ ] `qa.no-high-severity` — predicate over regression + quality
        findings.
  - [ ] `qa.broad-tests` (optional shell gate) — full test suite at HEAD.
  - [ ] `qa.security-review` (optional LLM gate) — invokes the existing
        `/security-review` skill on the cumulative diff.
  - [ ] `qa.non_goals_respected` (LLM gate) — diff doesn't violate any
        framing non-goal.
- [ ] Verdict logic: `pass` (all ACs met, no high-sev findings),
      `concerns` (informational findings, no halt), `fail` (unmet ACs or
      high-sev findings → trigger auto-recovery → still failing → surface
      to user with worktree branch preserved).
- [ ] CLI: `pilot qa --workflow <id>`.
- [ ] Test files:
  - [ ] `test/pilot-qa-evaluate.test.ts` (per-AC verification strategies).
  - [ ] `test/pilot-qa-recovery.test.ts` (bounded cycles, budget enforcement,
        recovery-exhausted halt).
  - [ ] `test/pilot-qa-gates.test.ts`.
  - [ ] `test/pilot-qa-artifact.test.ts` (Zod schema parse).
- [ ] **Verify:** a deliberately under-implemented build (planner instructed
      to skip an AC) results in QA `verdict: "fail"`, AC-strict auto-recovery
      runs, and either the second attempt completes the AC or the workflow
      halts with a structured failure.
- [ ] Commit and push.

---

## Step 7 — Followup phase

Auto-promote AC-derived followups (creates pre-approved child workflows);
interactive triage for quality/regression findings; deferred backlog.

- [ ] `src/pilot/followup/` directory with:
  - [ ] `auto-promote.ts` — for `proposedFollowups` with non-null
        `relatedAcId` whose AC is `unmet`/`partial` after recovery
        exhausts: creates a child workflow with seed scope (framing =
        AC, ACs = [AC]). Pre-approves both gates with provenance
        `{ approvedBy: "auto-promotion", parentWorkflowId }`.
  - [ ] `triage.ts` — interactive CLI for human-judgment items
        (regression findings, quality findings, no-relatedAcId followups).
        UI: `[p]romote / [d]efer / [i]gnore / [c]omment` per candidate.
  - [ ] `backlog.ts` — deferred entries land in
        `~/.glorious/.../pilot/followups/<repo>/`.
  - [ ] `artifact.ts` — `followup/candidates.json` records every candidate
        with disposition.
- [ ] CLI:
  - [ ] `pilot followup --workflow <id>` — interactive triage.
  - [ ] `pilot followup list` — browse the deferred backlog.
- [ ] Test files:
  - [ ] `test/pilot-followup-auto-promote.test.ts` (verifies child workflow
        creation, pre-approved gates, provenance recording).
  - [ ] `test/pilot-followup-triage.test.ts` (scripted user input).
  - [ ] `test/pilot-followup-backlog.test.ts`.
- [ ] **Verify:** a QA report containing one AC-derived followup and one
      quality finding correctly auto-promotes the AC followup into a child
      workflow that completes, while the quality finding waits in the
      interactive triage queue.
- [ ] Commit and push.

---

## Step 8 — `pilot run` orchestrator

Top-down command that walks all five phases. Default user entry.

- [ ] `src/pilot/cli/run.ts` — `pilot run "<goal>" [--no-qa] [--plan <path>]
      [--resume <workflowId>]`. Sequences scope → plan → build → qa →
      followup, halting on first phase failure.
- [ ] `--plan <path>` bypasses scope + plan, jumps to build (legacy flow
      preserved as opt-in).
- [ ] `--resume <workflowId>` picks up from the last completed phase.
- [ ] `pilot status --workflow <id>` (and `--run` alias) renders phase +
      task status table.
- [ ] `pilot logs --workflow <id> [phase] [taskId]` filters event log by
      phase.
- [ ] `pilot cost --workflow <id>` per-phase cost breakdown.
- [ ] `pilot artifact --workflow <id> <kind>` cats scope/framing/plan/qa/etc.
- [ ] Test files:
  - [ ] `test/pilot-run-orchestrator.test.ts` (end-to-end fixture: scope
        → plan → build → qa → followup, all phases run, the diff is
        committed, QA passes, no human turn after AC approval).
  - [ ] `test/pilot-cli-run.test.ts` (flag parsing, resume semantics,
        `--plan` bypass).
- [ ] **Verify:** full end-to-end `pilot run "<small goal>"` against a
      sample repo with deliberately-trivial scope and one task, all five
      phases run, the diff is committed, QA passes, no human turn after
      the AC approval.
- [ ] Commit and push.

---

## Step 9 — Docs + migration guide

Public surface, named-gate library, deprecation notes.

- [ ] Update `packages/harness-opencode/README.md` with the five-phase
      workflow overview and `pilot run` as the primary entry.
- [ ] Update `packages/harness-opencode/PILOT_TODO.md` to note v0.3 (this
      redesign) is shipped on top of v0.1+v0.2.
- [ ] `docs/pilot/named-gates.md` — gate library reference. Builtin gates
      under `src/pilot/gates/lib/`; user-layer at `~/.glorious/.../gates/`;
      repo-layer at `.glrs/gates/`. Override precedence: repo > user >
      builtin.
- [ ] `docs/pilot/migration-v3.md` — what changes for users:
  - [ ] `pilot.yaml` legacy form keeps working (verify-as-shell-gates
        translation).
  - [ ] `--run` is an alias for `--workflow`.
  - [ ] `pilot build <plan>` synthesizes a degraded scope and skips QA;
        recommended path is `pilot run "<goal>"`.
  - [ ] State DB auto-migrates on first read against a v1 schema.
- [ ] Update `packages/harness-opencode/AGENTS.md` to register
      `pilot-scoper`, `pilot-planner`, `pilot-qa` agents.
- [ ] Update changeset under `.changeset/` describing v0.3 redesign.
- [ ] **Verify:** docs render correctly; `--run` alias works; gate library
      override precedence is exercised by a fixture with all three layers
      populated.
- [ ] Commit and push.

---

## Cross-cutting verification

After each step, run:

- [ ] `bun test packages/harness-opencode` (no regression in pre-existing
      passing tests).
- [ ] `bun run typecheck` (no new errors introduced).
- [ ] `bun run build` (tsup clean).

Step 8 also runs the manual smoke test against a small real plan; step 3
also runs the manual smoke test for the self-healing build phase.

---

## Open questions deferred from ADR §10

- [ ] **Default executor model.** Decision deferred to step 5: ship with
      frontier default + `defaults.executor_model` configurable. Flip
      default to a small model (Qwen3-Coder / Kimi K2 / DeepSeek V3) only
      after `plan.task_self_containment` confidence is established
      (post-step-9).
- [ ] **QA cost cap.** Tier QA gates (cheap mandatory + expensive opt-in);
      cap recovery cycles via `defaults.max_qa_recovery_cycles` (default 2);
      enforce workflow's `max_total_cost_usd` across all phases including
      recovery.
