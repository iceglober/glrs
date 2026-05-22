# Wave 5 — TDD Execution Model

**Focus:** Restructure the autopilot execution loop around test-driven development. Each spec item carries an acceptance proof that the model writes first (red), then implements against (green). "Test" is broadly defined — unit tests, API checks via curl, structural greps, type checks, playwright flows, or any command that exits 0 on success.

---

## Design principles

1. **Red first.** The model writes the acceptance proof before the implementation. The proof MUST fail initially — if it passes before implementation, either the proof is trivial or the work was already done.
2. **Green means done.** An item is only `checked: true` when its verify command exits 0. The model runs verify itself before marking checked.
3. **Proofs are diverse.** Not everything is a unit test. A proof is any deterministic command that exits 0 when the acceptance criterion is met:
   - `bun test test/auth/permissions.test.ts` (unit test)
   - `curl -sf http://localhost:3000/api/health | jq -e '.status == "ok"'` (API check)
   - `grep -q "export function createUser" src/users/index.ts` (structural)
   - `tsc --noEmit --project tsconfig.json` (type check)
   - `bunx playwright test tests/login.spec.ts` (e2e via playwright MCP)
   - `git diff --stat HEAD | grep -q "src/auth/"` (change detection)
4. **Enrichment generates the proof sketch.** The enrichment phase produces a `proof` field on each item — a natural-language description of what the proof should assert, specific enough for GLM-5 to write it as a shell command or test file.
5. **Execution is red-green per item.** The per-item prompt tells the model: write the proof (expect failure), implement, verify (expect success), mark checked.

---

## Spec schema changes

Current:
```yaml
items:
  - id: "1.1"
    intent: "Add role-based access control to /api/users"
    checked: false
    files:
      - path: src/auth/rbac.ts
        isNew: true
    verify: "bun test test/auth/rbac.test.ts"
```

New (additive — `verify` stays, `proof` is added):
```yaml
items:
  - id: "1.1"
    intent: "Add role-based access control to /api/users"
    checked: false
    files:
      - path: src/auth/rbac.ts
        isNew: true
    verify: "bun test test/auth/rbac.test.ts"
    proof: |
      Test file: test/auth/rbac.test.ts
      Assertions:
        - createUser with role "admin" can access /api/users (200)
        - createUser with role "viewer" gets 403 on POST /api/users
        - Missing auth header returns 401
      Setup: mock the auth middleware, use supertest for HTTP assertions
    proof_type: "unit_test"  # unit_test | api_check | structural | typecheck | e2e | custom
```

The `proof` field gives the model enough detail to write a meaningful failing test. The `proof_type` hints at the approach but isn't prescriptive.

---

## Items

- [x] 5.1 **Add `proof` and `proof_type` to spec schema.** Update `spec-schema.ts` to accept optional `proof: string` and `proof_type: string` fields on `SpecItem`. Update `specItemToPlanItem` to pass them through. Backward compatible — existing specs without these fields still work.

  - files (MODIFIED):
    - `packages/autopilot/src/spec-schema.ts` — add fields to SpecItem
    - `packages/autopilot/src/spec-parser.ts` — pass through in `specItemToPlanItem`
    - `packages/autopilot/src/plan-parser.ts` — add to PlanItem type
  - verify: `cd packages/autopilot && bun test`

- [x] 5.2 **Update enrichment prompt to generate `proof` field.** The enrichment prompt for wave files should instruct the LLM to generate a `proof` field for each item — a natural-language description of what the acceptance proof should assert, specific enough for a code-generation model to write it. Also generate `proof_type` based on the verify command pattern.

  - files (MODIFIED):
    - `packages/autopilot/src/plan-enrichment.ts` — update `buildSpecGenerationPrompt` for phase files
  - verify: `cd packages/autopilot && bun test`

- [x] 5.3 **TDD execution prompt.** Rewrite the per-item execution prompt to enforce red-green-refactor:
  
  ```
  You are implementing ONE item using test-driven development.
  
  ## Your item
  - id: {id}
  - intent: {intent}
  - verify: {verify}
  - proof: {proof}
  
  ## Workflow (follow exactly):
  1. WRITE THE PROOF FIRST. Create or update the test/check described in `proof`.
     Run `{verify}` — it MUST fail (red). If it passes, your proof is trivial.
  2. IMPLEMENT. Write the minimum code to make `{verify}` pass.
  3. VERIFY. Run `{verify}` — it MUST pass (green). If it fails, fix your implementation.
  4. MARK DONE. Only after verify passes: set checked: true in the spec YAML.
  
  Do NOT mark checked:true until verify passes. Do NOT skip the red step.
  ```

  - files (MODIFIED):
    - `packages/autopilot/src/loop-session.ts` — update per-item prompt in `runItemsForPhase`
  - verify: `cd packages/autopilot && bun test`

- [x] 5.4 **Verify-before-check enforcement.** Update the post-iteration check: if an item is marked `checked: true` but its verify command fails, UNCHECK it (set back to `checked: false`). This prevents the model from lying about completion. Log a warning when this happens.

  - files (MODIFIED):
    - `packages/autopilot/src/loop-session.ts` — after verify gate, uncheck items whose verify failed
    - `packages/autopilot/src/spec-writer.ts` — add `markItemUnchecked(planDir, phaseFile, itemId)`
  - verify: `cd packages/autopilot && bun test`

- [x] 5.5 **Config: `execution_style` setting.** Add `execution_style: "tdd" | "direct"` to the autopilot config schema. Default: `"tdd"`. When `"direct"`, use the current prompt (no red-green enforcement). When `"tdd"`, use the new prompt from 5.3. This allows repos that don't want TDD to opt out.

  - files (MODIFIED):
    - `packages/autopilot/src/loop-session-types.ts` — add `executionStyle?: "tdd" | "direct"`
    - `packages/autopilot/src/loop-session.ts` — branch on execution style for prompt selection
  - verify: `cd packages/autopilot && bun test`

- [x] 5.6 **Proof-type-aware verify timeout.** Different proof types need different timeouts:
  - `unit_test`: 30s (fast, in-process)
  - `api_check`: 10s (network call)
  - `structural` / `typecheck`: 60s (may compile)
  - `e2e`: 120s (browser startup + navigation)
  - `custom`: use `config.verify_timeout` (default 300s)
  
  The verify runner reads `proof_type` from the item and applies the appropriate timeout.

  - files (MODIFIED):
    - `packages/autopilot/src/verify-runner.ts` — accept proof_type, apply timeout
  - verify: `cd packages/autopilot && bun test`

---

## Non-goals

- Generating the actual test code during enrichment (that's the model's job during execution)
- Running tests in parallel (future optimization)
- Playwright MCP integration (the model uses it via bash tool — no special support needed)
- Changing the verify gate for the `"direct"` execution style (backward compatible)
