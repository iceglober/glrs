---
name: adversarial-review-rubric
description: Use when reviewing a diff or PR against a plan or acceptance criteria.
---

# Adversarial review rubric

## MECE rubric (five dimensions)

Every review evaluates five dimensions — every dimension must pass for `[PASS]` or `[PASS_SPEC]`:

1. **Correctness** — Does the code do what the plan says? Are acceptance criteria met?
2. **Completeness** — Are all plan items implemented? Are edge cases handled?
3. **Consistency** — Does the code follow existing patterns? Are naming/types consistent?
4. **Safety** — Are there security, data-loss, or deployment risks?
5. **Scope** — Does the diff stay within the plan's `## File-level changes`? No unplanned additions?

## Progressive strictness

Strictness increases across Assess iterations within a session:

- **Level 1/3 (first Assess):** Standard review. Trust-recent-green applies. Focus on correctness and scope.
- **Level 2/3 (second Assess, after FIX-INLINE loop):** Elevated scrutiny. Re-run tests unconditionally. Check all five MECE dimensions explicitly.
- **Level 3/3 (third Assess, after LOOP-TO-PLAN):** Maximum strictness. Treat as a fresh review. Escalate to `@code-reviewer-thorough` regardless of diff size.

## Red CI blocks merge

**Red CI blocks merge.** Any red output from typecheck, test, or lint is a FAIL regardless of whether the failure appears pre-existing. Pre-existing status does not exempt a failure from blocking merge. There is no deferral path.

## Unevidenced pre-existing claim rejection

**Unevidenced pre-existing claims are rejected.** A claim that a failure is "pre-existing" or "unrelated" is only valid with ALL THREE of:

- (a) a specific commit SHA showing the failure pre-dates this branch,
- (b) `git log` output confirming the commit,
- (c) merge-base reproduction confirming the failure exists on the merge-base.

Without all three, treat the claim as unevidenced and fail the review.

## Return tokens

Return tokens are agent-role contracts and stay in each agent's own prompt. For reference:

- `@spec-reviewer` uses: `[PASS_SPEC]` or `[FAIL_SPEC: <summary>]`
- `@code-reviewer` and `@code-reviewer-thorough` use: `[PASS]`, `[LOOP-TO-PLAN: <summary>]`, or `[FIX-INLINE: <summary>]`

Use the tokens appropriate to your role as defined in your own prompt.
