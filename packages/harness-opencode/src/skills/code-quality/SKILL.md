---
name: code-quality
description: Four principles for autonomous code quality — think before coding, simplicity first, surgical changes, goal-driven execution. Load this skill when planning, building, or reviewing any non-trivial change. Derived from observed patterns in AI-agent-authored PRs where review feedback clustered around wrong assumptions, overcomplication, scope creep, and missing failure-mode coverage.
---

# Code Quality Principles

Four principles that prevent the most common classes of defects in AI-agent-authored code. Each principle applies at every pipeline phase, but the enforcement actions differ by phase. Load the rule file for your current role.

These principles are derived from empirical analysis of recurring review feedback on agent-authored PRs. The top defect categories — wrong assumptions at system boundaries, overcomplicated implementations, unplanned side-effects, and happy-path-only coverage — are all preventable by applying the right check at the right phase.

## The four principles

1. **Think Before Coding** — Don't assume. Surface ambiguity, verify cross-boundary names, present tradeoffs, stop when confused.
2. **Simplicity First** — Minimum code that solves the problem. No speculative features, no single-use abstractions, no "flexibility" that wasn't requested.
3. **Surgical Changes** — Touch only what you must. Every changed line traces to the plan. Minimize blast radius on security-sensitive files.
4. **Goal-Driven Execution** — Define success criteria with real verify commands. Enumerate failure modes. Test the error paths, not just the happy path.

## Phase-specific rules

Each rule file applies all four principles through the lens of a specific pipeline phase. Load the one that matches your current role:

1. [`rules/gap-analysis.md`](rules/gap-analysis.md) — For `@gap-analyzer`. Surface hidden assumptions, missing failure modes, naming mismatches, and overscoped plans before the draft is written.

2. [`rules/planning.md`](rules/planning.md) — For `@plan` and `@plan-reviewer`. Verify every cross-boundary identifier. Reject plans that exceed what the goal requires. Require failure-mode coverage in acceptance criteria.

3. [`rules/building.md`](rules/building.md) — For `@build`. Enforce surgical changes. Verify names before using them. Flag unplanned edits. Write failure-path tests before happy-path code.

4. [`rules/review.md`](rules/review.md) — For `@qa-reviewer` and `@qa-thorough`. Verify failure-path coverage in the diff. Grep-confirm cross-boundary string literals. Reject diffs with unplanned scope.

## When to load this skill

Any non-trivial change — defined as any plan with 3+ file-level changes, or any change touching a system boundary (API contract, database schema, config/security file, cross-service integration).

Do NOT load for trivial work (typo fixes, single-file renames, doc-only changes). The overhead isn't worth it.

## Observable outcomes

These are the signals that the principles are working:

- Fewer naming mismatches at system boundaries (cross-boundary identifiers are grep-confirmed before use)
- Smaller, more focused PRs (plans that exceed ~15 files get split or justified)
- Zero unplanned changes in diffs (every changed line traces to the plan)
- Failure-mode coverage in acceptance criteria (negative tests exist for medium+ risk changes)
- Narrower security-config changes (specific paths instead of broad globs)
