---
touches: [pilot, pilot-worker, pilot-verify, pilot-schema]
establishes:
  - pilot-gate-abstraction
  - gate-produces-status
  - gate-continuation-semantics
supersedes: []
---

# ADR: Pilot Gates — a composable post-task validation abstraction

---

---

## 1. Context

The pilot subsystem executes tasks from a `pilot.yaml` DAG unattended. For each task, the worker runs a fixed sequence of validation steps at different points in the lifecycle:

**Before the agent starts (environment validation):**

1. **Baseline** — runs broad regression checks (`defaults.verify_after_each` + milestone verify + `pilot.json after_each` + `pilot.json baseline`) on the clean tree. Deliberately excludes task-specific `task.verify` commands (those test code the agent is about to create). Implementation: reuses `runVerify()` with a different command set. Produces `task.baseline.passed` or `task.baseline.failed` events. On failure, the task aborts immediately — no agent session is created.

**After the agent reports idle (output validation):**

2. **Verify** — runs shell commands declared in `task.verify` + `defaults.verify_after_each` + milestone verify + `pilot.json after_each`. Implementation: `src/pilot/verify/runner.ts` → `runVerify()`. Produces `task.verify.passed` or `task.verify.failed` events.

3. **Touches** — diffs the working tree against `task.touches` globs to detect out-of-scope edits. Implementation: `src/pilot/verify/touches.ts` → `enforceTouches()`. Produces `task.touches.violation` events on failure.

4. **Commit** — `git add -A && git commit`. The pre-commit hook acts as an implicit check (TODO scanners, lint-staged, PHI scans). Produces `task.commit.failed` on hook rejection.

These four steps share a common shape:

- They run at defined points in the task lifecycle — either before the agent starts or after it finishes.
- They produce a **binary status** (pass/fail).
- On failure, the worker either **aborts** (pre-agent gates) or **retries** (post-agent gates, via fix-prompt) or **terminates** the task.
- Their results are logged as **structured events** following the `task.<gate>.<status>` convention (`task.baseline.passed`, `task.verify.passed`, `task.touches.violation`, `task.commit.failed`).

But they are not modeled as a unified concept. Each is a bespoke code path in `runOneTaskImpl` (lines 542-868 of `worker.ts`). Adding a new validation step requires editing the worker's inner loop, adding new event kinds ad-hoc, and threading new configuration through the plan schema.

### Prior art in this repo

- The event system (`src/pilot/state/events.ts`) already uses a `task.<gate>.<status>` naming convention — `task.verify.passed`, `task.touches.violation`. This convention emerged organically and reveals the abstraction waiting to be formalized.
- The plan schema (`src/pilot/plan/schema.ts`) already separates `verify` (commands) from `touches` (globs) from `tolerate` (globs) as distinct per-task fields. Each is a different "kind" of gate with different configuration shapes.
- The `pilot-planning` skill's rules (`verify-design.md`, `touches-scope.md`) already teach the planner to reason about these as separate concerns with different design principles.
- The worker's attempt loop already handles all three failure modes identically: set `lastFailure`, emit event, `continue` if attempts remain, `markFailed` if exhausted.

## 2. Decision

### 2.1 Data model

Introduce a **Gate** as a named, typed checkpoint in the pilot task lifecycle.

A gate has:

| Field | Type | Description |
|---|---|---|
| `kind` | `string` (enum-like) | Identifies the gate type: `"baseline"`, `"verify"`, `"touches"`, or future types |
| `phase` | `"pre" \| "post"` | When the gate runs: `pre` = before the agent starts (environment validation); `post` = after the agent reports idle (output validation) |
| `status` | `"passed" \| "failed" \| "violation" \| "skipped"` | The outcome of running the gate |
| `retryable` | `boolean` | Whether a failure should trigger a fix-prompt retry (only meaningful for `post` gates; `pre` gates abort immediately) |
| `blocking` | `boolean` | Whether a failure prevents task success (always `true` for built-in gates; future gates may be advisory) |

**Gate phases** are the key structural insight. The worker's per-task lifecycle has two distinct validation windows:

- **Pre-agent gates** run once, on the clean tree, before the agent starts. They validate that the *environment* is healthy enough for the agent to work. A pre-gate failure aborts the task immediately — no retries, no fix-prompt, because the agent hasn't done anything yet. The failure is environmental, not behavioral.

- **Post-agent gates** run after the agent reports idle, inside the attempt loop. They validate the agent's *output*. A post-gate failure triggers a fix-prompt and retry (up to `maxAttempts`). The agent caused the failure and can fix it.

Built-in gates (ship with v0.1 of the abstraction):

| Gate kind | Phase | Config source | Runner | Retryable | Blocking |
|---|---|---|---|---|---|
| `baseline` | `pre` | `defaults.verify_after_each` + milestone + `pilot.json baseline` + `pilot.json after_each` | `runVerify()` (same runner, different command set) | No (aborts immediately) | Yes |
| `verify` | `post` | `task.verify` + `defaults.verify_after_each` + milestone + `pilot.json after_each` | `runVerify()` | Yes | Yes |
| `touches` | `post` | `task.touches` + `task.tolerate` + `DEFAULT_TOLERATE` | `enforceTouches()` | Yes | Yes |

**Commit is not a gate.** It runs after all post-gates pass as a post-pipeline action. It's the only step that mutates state (creates a git commit), and keeping it outside the pipeline preserves the pipeline's contract as "pure validation, no side effects." The `task.commit.failed` event still follows the `task.<step>.<status>` naming convention for log consistency, but `commitAll` does not implement the `Gate` interface.

**Baseline gate specifics:** The baseline gate runs the broad regression checks (plan-level `verify_after_each`, milestone verify, `pilot.json after_each`, `pilot.json baseline`) but deliberately *excludes* task-specific `task.verify` commands. Rationale: task-specific verify often tests code the agent is about to *create* — of course it fails before the agent starts. That's TDD, not a broken environment. The baseline catches: wrong port, missing migration, cross-package type breakage from prior tasks. It emits `task.baseline.passed` or `task.baseline.failed` events.

Future gate kinds (not implemented now, but the abstraction must accommodate):

| Gate kind | Phase | Config source | Runner | Retryable | Blocking |
|---|---|---|---|---|---|
| `inference` | `post` | Declared in plan YAML | Calls an LLM, asserts on structured output | Configurable | Configurable |
| `lint` | `post` | Declared in plan YAML or `pilot.json` | Runs linter, parses output | Yes | Configurable |
| `review` | `post` | Declared in plan YAML | Submits diff to a review agent, asserts pass | No (expensive) | Configurable |
| `env-check` | `pre` | Declared in `pilot.json` or plan YAML | Runs environment probes (port reachable, service healthy) | No | Yes |

### 2.2 Resolution / runtime semantics

The worker's per-task lifecycle becomes:

```
[pre-gate pipeline] → agent works → idle → [post-gate pipeline] → commit → success/fail
```

**Pre-gate pipeline** (runs once per task, before the attempt loop):

1. Assemble pre-phase gates (currently: baseline only).
2. Run each in order. Each returns a `GateResult`.
3. On any `failed`/`violation` → `markFailed` immediately, emit `task.<gate>.failed` event. No agent session is created. No retries — the environment is broken, not the agent's work.
4. On all `passed` → proceed to agent session creation and the attempt loop.

**Post-gate pipeline** (runs per-attempt, after agent idle):

1. Assemble post-phase gates (currently: verify → touches → commit).
2. Run each in order. Each returns a `GateResult`.
3. On `passed` → continue to next gate.
4. On `failed`/`violation` + `retryable` + attempts remain → set `lastFailure` from gate output, `continue` the attempt loop (send fix-prompt to agent).
5. On `failed`/`violation` + not retryable OR attempts exhausted → `markFailed`, emit terminal event.
6. On `skipped` → continue to next gate (gate decided it doesn't apply).
7. All gates `passed` → `commitAll` runs (outside the pipeline). On commit success → `markSucceeded`. On commit failure (pre-commit hook) → route back through fix-prompt loop like any retryable failure.

Each gate:

1. Receives the task context (cwd, sinceSha, task config, attempt number).
2. Executes its check.
3. Returns a `GateResult`:
   ```typescript
   type GateResult = {
     gate: string;        // e.g. "baseline", "verify", "touches"
     phase: GatePhase;    // "pre" | "post"
     status: GateStatus;  // "passed" | "failed" | "violation" | "skipped"
     output?: string;     // human-readable failure detail
     metadata?: Record<string, unknown>; // gate-specific structured data
   };
   ```

**Gate ordering is fixed for built-in gates:** Pre: baseline. Post: verify → touches. Commit runs after all post-gates pass (outside the pipeline). This matches the current behavior and is semantically correct (baseline proves environment; verify proves correctness; touches proves scope; commit persists the result). Future user-defined gates slot into configurable positions within their phase, declaring a `position` relative to built-ins (e.g., `"after:verify"`, `"before:touches"`).

**Event naming convention (formalized):** `task.<gate-kind>.<status>`. Examples: `task.baseline.passed`, `task.verify.passed`, `task.touches.violation`, `task.inference.failed`. This convention already exists in the codebase; the ADR formalizes it as a contract.

### 2.3 External API contract

Not applicable. Gates are internal to the pilot worker; they do not expose HTTP endpoints or CLI commands beyond what already exists (`pilot status`, `pilot logs` — which surface gate events via the existing event system).

### 2.4 Internal API contract

New interface in `src/pilot/verify/` (or a new `src/pilot/gates/` directory):

```typescript
// src/pilot/gates/types.ts

export type GatePhase = "pre" | "post";
export type GateStatus = "passed" | "failed" | "violation" | "skipped";

export type GateResult = {
  gate: string;
  phase: GatePhase;
  status: GateStatus;
  retryable: boolean;
  output?: string;
  metadata?: Record<string, unknown>;
};

export type GateContext = {
  cwd: string;
  sinceSha: string;
  task: PlanTask;
  attempt: number;
  maxAttempts: number;
  abortSignal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onLine?: (args: { stream: "stdout" | "stderr"; line: string; command: string }) => void;
};

export type Gate = {
  kind: string;
  phase: GatePhase;
  run(ctx: GateContext): Promise<GateResult>;
};
```

The worker calls gates via a `GatePipeline`:

```typescript
// src/pilot/gates/pipeline.ts

export type GatePipeline = {
  gates: Gate[];
  run(ctx: GateContext): Promise<GateResult[]>;
  // Stops at first non-passed result (short-circuit)
};

export function createPrePipeline(gates: Gate[]): GatePipeline;
export function createPostPipeline(gates: Gate[]): GatePipeline;
```

The two pipeline constructors enforce phase correctness at assembly time — you can't accidentally put a `pre` gate in the post-pipeline or vice versa.

Existing implementations (`runVerify`, `enforceTouches`, `commitAll`) are wrapped as `Gate` implementations without changing their internal logic. The refactor is structural, not behavioral.

### 2.5 UI design

Not applicable. Gates have no UI surface. Their results are visible via `pilot status` and `pilot logs`, which already render events — the event naming convention (`task.<gate>.<status>`) is the presentation contract.

### 2.6 External integration surface

Not applicable. Gates run locally in the worker process.

### 2.7 Role-based access matrix

Not applicable. Gates execute with the same permissions as the worker process (the user's shell). No new privilege boundaries are introduced.

### 2.8 Migration strategy

**Phase 1 (structural refactor, no behavior change):**
- Extract `Gate` interface, `GatePhase`, and `GatePipeline` into `src/pilot/gates/`.
- Wrap the baseline check as `BaselineGate` (phase: `pre`).
- Wrap `runVerify` and `enforceTouches` as `VerifyGate` and `TouchesGate` (phase: `post`).
- Commit remains outside the pipeline — it runs after all post-gates pass (not a gate, per §6.2 resolution).
- Replace the inline gate logic in `runOneTaskImpl` with `prePipeline.run(ctx)` before the attempt loop and `postPipeline.run(ctx)` inside it.
- All existing tests must pass unchanged — the refactor is purely structural.

**Phase 2 (schema extension for user-defined gates):**
- Add optional `gates:` field to `TaskSchema` in `schema.ts`.
- Define a `GateDefinition` schema for plan-declared gates (kind, config, ordering).
- Built-in gates remain implicit (verify/touches/commit always run); user-defined gates are additive.

**Phase 3 (inference gate as first user-defined gate):**
- Implement `InferenceGate` — calls an LLM with a prompt template, asserts on structured output.
- Plan authors declare it in `gates:` with a prompt and expected-output schema.

No database migration needed — gates produce events via the existing `appendEvent` system with the existing `task.<gate>.<status>` convention. The events table schema is unchanged.

## 3. Consequences

### Positive

- **Extensibility without worker surgery.** Adding a new gate type (inference, lint, review) requires implementing the `Gate` interface and registering it — no changes to the worker's inner loop.
- **Composability.** Plan authors can mix gates per-task. A task that needs LLM review adds an inference gate; a task that's purely mechanical skips it.
- **Consistent retry semantics.** Every gate gets the same retry/terminate logic. No more bespoke `if (attempt < opts.maxAttempts) continue` per validation step.
- **Event naming is a contract, not an accident.** `task.<gate>.<status>` becomes a documented pattern that tooling (log parsers, dashboards, `pilot status`) can rely on.
- **Future parallelism.** Independent gates (e.g., lint + inference) could run concurrently within the pipeline. The current sequential model is a valid starting point; parallelism is an optimization, not a redesign.

### Negative / trade-offs

- **Abstraction cost.** The current inline code is simple and readable. Introducing `Gate`, `GateContext`, `GatePipeline` adds indirection. Justified only if we expect 2+ new gate types within 6 months (inference gate is already on the roadmap).
- **Phase 1 is a pure refactor with no user-visible value.** It only pays off when Phase 2/3 land. If the inference gate never ships, the abstraction is over-engineering.

### Neutral / noted

- The `verify/` directory may be renamed to `gates/` or the new code may live alongside it. Either is fine; the ADR doesn't prescribe directory naming beyond "the interface lives somewhere discoverable."
- The `pilot-planning` skill's rules (`verify-design.md`, `touches-scope.md`) remain valid — they teach the planner about specific gate types, not about the gate abstraction itself. A future `gates-overview.md` rule could link them.

### Unspecified interactions with existing mechanisms

- **STOP detection.** `StopDetector` runs concurrently with the agent (during `waitForIdle`), not after it. It's not a gate — it's a session-level abort signal. The gate pipeline runs only after idle is reached without a STOP.
- **`cascadeFail` in the scheduler.** Gate failures that exhaust retries trigger `markFailed`, which the main loop uses to cascade-fail dependents. This coupling is unchanged — gates produce the same terminal state that cascadeFail already consumes.
- **`pilot-plugin.ts` permission enforcement.** The plugin denies git operations to the builder agent. The `CommitGate` runs in the worker process (not the agent session), so it's unaffected by agent permissions. This is already the case today.
- **Setup hook (`.glrs/hooks/pilot_setup`).** The setup hook runs once per `pilot build` invocation, before the task loop begins. It is NOT a gate — it's a run-level lifecycle event, not a per-task checkpoint. Gates are per-task; setup is per-run. The baseline gate validates that setup *succeeded* (ports reachable, migrations applied) but doesn't invoke setup itself.

## 4. Alternatives considered

### Alternative 1: Keep gates as inline code, add new steps ad-hoc

Rejection: works for 3 gates but doesn't scale. Each new gate requires editing the worker's 150-line inner loop, adding bespoke event emission, threading config through the plan schema, and updating the fix-prompt logic. The inference gate alone would add ~40 lines to an already-complex function. The pattern is clear enough that formalizing it now prevents the worker from becoming unmaintainable.

### Alternative 2: Plugin/hook system (external gate executables)

A gate could be an external script (like the `fresh-reset` hook pattern), discovered by convention (`.glrs/gates/<name>`). Rejection: gates need deep integration with the worker's retry loop, abort signals, and event system. An external process can't participate in `GateContext` or return structured `GateResult` without a serialization protocol. The complexity of that protocol exceeds the complexity of the `Gate` interface. Internal-first; external-gate support can be a future Phase 4 if demand materializes.

### Alternative 3: Middleware/interceptor pattern (before/after hooks on the attempt loop)

Model gates as generic before/after hooks rather than a typed pipeline. Rejection: too generic. Gates have specific semantics (status enum, retry behavior, event naming) that a generic hook system would need to re-derive per implementation. The typed `Gate` interface is more constraining and therefore more useful — it tells implementers exactly what they need to provide.

## 5. Decision linkages

- **Establishes:** `pilot-gate-abstraction` — future ADRs that add gate types reference this convention.
- **Establishes:** `gate-produces-status` — the `GateStatus` enum and `task.<gate>.<status>` event naming are contracts.
- **Establishes:** `gate-continuation-semantics` — the retry/terminate decision tree is the contract between gates and the worker.
- **Future extension:** Inference gate ADR (Phase 3) — will define the plan-YAML schema for declaring an inference gate, the prompt template format, and the assertion semantics.
- **Future extension:** Advisory (non-blocking) gates — gates that log warnings but don't fail the task. Requires extending `GateResult` with a `blocking` field.
- **Depends on:** Existing `src/pilot/verify/runner.ts`, `src/pilot/verify/touches.ts`, `src/pilot/worker/worker.ts` — these are the implementations being wrapped.

## 6. Open questions

None. All questions resolved during drafting:

### Resolved during drafting

1. **Should `gates/` replace `verify/` or live alongside it?** Replace. The `verify/` directory contains only two files (`runner.ts`, `touches.ts`) — both become gate implementations under `gates/`. `git log --follow` handles the rename. Two directories for the same concept is worse than a clean rename.

2. **Should `CommitGate` be a real gate or remain special-cased?** Special-cased. Commit is the only step that mutates state (creates a git commit). Keeping it outside the pipeline preserves the pipeline's contract as "pure validation, no side effects." The worker calls `commitAll` after `postPipeline.run()` returns all-passed. This means the pipeline has exactly three post-gates (verify → touches) and commit is a post-pipeline action, not a gate. The `task.commit.failed` event still follows the `task.<step>.<status>` naming convention for consistency, but commit is not a `Gate` implementation.

3. **Per-task `gates:` or top-level `gates:`?** Per-task `gates:` field in the plan schema. More flexible — different tasks can have different gate configurations. A `defaults.gates` field provides the "run this gate on every task" convenience without a separate top-level field. Mirrors how `verify` and `touches` are already per-task with `defaults.verify_after_each` as the cross-task layer.

4. **Gate ordering: fully configurable or fixed built-ins with user slots?** Fixed built-in order. User-defined gates declare a `position` relative to built-ins (e.g., `"after:verify"`, `"before:touches"`). This prevents user gates from accidentally reordering the semantic sequence (verify-before-touches is load-bearing — you want to know if the code is correct before checking scope). User gates that don't declare a position default to running after all built-in post-gates but before commit.

## 7. Pre-implementation codebase investigation

None. All items confirmed during drafting:

### Resolved during drafting

1. **Hidden coupling in `runVerify` and `enforceTouches`?** Confirmed: neither reads module-level state. `runVerify` takes `commands` + `RunVerifyOptions` (cwd, env, onLine, abortSignal, timeoutMs, outputCapBytes). `enforceTouches` takes `cwd`, `sinceSha`, `allowed`, `tolerate`. Both are stateless — all inputs arrive via arguments. Wrapping as `Gate` implementations requires no refactoring of their internals.

2. **Can `onLine` generalize to all gates?** Yes. `GateContext.onLine` is already typed as optional. Gates that produce streaming output (verify) call it; gates that don't (touches) ignore it. No interface change needed — the optional field handles both cases.

3. **Can `commitAll`'s error handling express as a `GateResult`?** Moot — commit stays outside the pipeline (see §6.2 resolution). But for the record: yes, it could. `commitAll` throws on failure; the catch extracts `err.message` (which includes pre-commit hook stderr). A `GateResult` with `status: "failed"`, `output: errMsg` carries identical information. The fix-prompt reads `lastFailure.output` as a plain string — no structured data beyond the message is needed.

## 8. References

- `src/pilot/worker/worker.ts` — current inline gate logic (lines 542-868: baseline at 542-577, verify at 722-765, touches at 774-808, commit at 823-868)
- `src/pilot/verify/runner.ts` — verify gate implementation (`runVerify`)
- `src/pilot/verify/touches.ts` — touches gate implementation (`enforceTouches`)
- `src/pilot/state/events.ts` — event system (`appendEvent`, `task.<gate>.<status>` convention)
- `src/pilot/plan/schema.ts` — plan schema (`TaskSchema.verify`, `TaskSchema.touches`, `TaskSchema.tolerate`)
- `src/pilot/worker/pilot-config.ts` — project-level verify config (`baseline`, `after_each`)
- `src/skills/pilot-planning/rules/verify-design.md` — planner guidance for verify gates
- `src/skills/pilot-planning/rules/touches-scope.md` — planner guidance for touches gates
- Convention established: `pilot-gate-abstraction`, `gate-produces-status`, `gate-continuation-semantics`
