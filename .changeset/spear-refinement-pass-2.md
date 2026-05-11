---
"@glrs-dev/harness-plugin-opencode": minor
---

Restructure the SPEAR protocol (PRIME's five-stage arc) across four areas: Assess quality, failure discipline, skill modularity, and agent-contract hygiene.

**Breaking changes** (match the prior `@assessor` rename's hard-break pattern):
- `@assessor` is replaced by `@spec-reviewer` (first pass, returns `[PASS_SPEC]` or `[FAIL_SPEC]`) and `@code-reviewer` (second pass, runs only on PASS_SPEC, returns `[PASS]` / `[LOOP-TO-PLAN]` / `[FIX-INLINE]`). User configs referencing `@assessor` by name will fail to resolve — update to the appropriate replacement.
- `@assessor-thorough` is renamed to `@code-reviewer-thorough` (same role: opus-tier backstop for high-risk diffs that re-runs the full suite unconditionally).
- Registered agent count: 20 → 21.

**Assess rigor (two-stage review + MECE rubric):**
- Every Assess cycle now dispatches two subagents sequentially instead of one, roughly doubling the subagent calls per review cycle. The spec pass is cheaper; the code-quality pass runs only if spec passed.
- Assess delegations carry a five-dimension MECE rubric (Correctness, Completeness, Consistency, Safety, Scope) and a progressive-strictness signal (Level 1/2/3) that tightens across Assess iterations.
- PRs with red CI (typecheck, lint, or tests failing) now fail Assess regardless of whether the failure appears pre-existing. "Pre-existing" claims require three-part evidence: a specific commit SHA, `git log` output showing the failure pre-dates the branch, and merge-base reproduction. Claims without all three are auto-rejected.

**Failure discipline (no-defer policy):**
- The hard rule that allowed logging pre-existing failures to a plan's `## Open questions` section and deferring them is removed.
- `@build` now runs a mandatory root-cause diagnosis protocol on any unexpected test/lint/typecheck failure: merge-base reproduction, `git blame`, rationalization table countering common excuse patterns ("likely pre-existing", "unrelated to my change", etc.).
- If fixing a failure would require touching more than ~5 files outside the plan's `## File-level changes`, `@build` STOPs with a reorganization proposal for PRIME to present to the user — there is no autonomous deferral path.

**TDD enforcement:**
- For any plan with a `## Test plan` entry or a `tests:` field in the acceptance-criteria fence, `@build` now enforces TDD order: write the test first, verify it fails, then implement. Tests in a just-written RED state are explicitly carved out of the failure-diagnosis protocol — they're expected failures, not unexpected ones.

**New bundled skills:**
- `spear-protocol` — the full SPEAR stage logic (Bootstrap, Scope, Plan, Execute, Assess, Resolve). Loaded by PRIME at session start. Inline fallback retained in `prime.md` in case skill-loading is unavailable.
- `root-cause-diagnosis` — the failure-diagnosis protocol + rationalization table. Loaded by `@build` and its strict-executor variant on unexpected failures.
- `adversarial-review-rubric` — the MECE rubric, progressive strictness levels, Red-CI-blocks-merge rule, and three-part evidence test. Loaded by all Assess-layer agents before reviewing.

**Agent-contract changes:**
- `@build` gains a four-status return protocol: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- `@build` now reports guidance deviations (item (e) of its return payload) when PRIME's Execute-prompt guidance permits multiple readings and `@build` picked one. Same "silence is not acceptable" bar as plan-file mutations.
- PRIME runs a pre-dispatch consistency check before every `@build` dispatch: re-read the Execute prompt against the plan and against any already-drafted follow-up prompts. Contradictions caught pre-dispatch avoid the downstream blame-misattribution pattern where faithful agent execution gets narrated as deviation.
- `@plan` bans placeholder phrases (TBD, TODO, "implement later", etc.) and runs a self-review checklist (spec coverage, placeholder scan, type/name consistency) before handing to `@plan-reviewer`.
- `@build`'s prompt is trimmed of orchestration context per the Minimal Contract principle (subagents perform worse when carrying parent-level workflow philosophy).

**Other refinements:**
- PRIME's Scope grounding dispatches parallel `@code-searcher` calls in a single message when grounding touches 3+ independent subsystems.
- PRIME's Plan stage detects multi-subsystem requests (3+ independent subsystems with no shared interface) and asks whether to split into separate plans.
- Delegation prompts apply the Minimal Contract minimality test: remove any sentence that doesn't help the subagent produce a better result. Non-goals prefer positive-instruction form ("Only modify files listed above") over negative lists when the positive form is shorter.
