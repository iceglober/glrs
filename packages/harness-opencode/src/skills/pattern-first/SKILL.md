---
name: pattern-first
description: Decide the implementation pattern BEFORE writing code that introduces a new concept or repeats an existing theme. Inventory the incumbent pattern, test its sustainability, then follow / extend / replace / quarantine — never silently propagate a bad pattern. Load when planning a new concept, adding the Nth instance of a theme, or when a Mirror file looks like a shaky precedent.
---

# Pattern-First

Existing code is precedent, not authority. The most expensive defect class in agent-authored code is a bad pattern copied faithfully: each new instance looks consistent, passes review on "matches existing code", and raises the cost of ever fixing the pattern. This skill is the procedure for spending deliberate thought on the pattern *before* implementation locks it in.

## When this applies

Run the procedure when ANY of:

1. **New concept** — the change introduces a new noun to the system (a new kind of entity, a new config surface, a new lifecycle, a new cross-cutting concern). There is no incumbent to copy; the pattern is being *set*, and everything after will copy it.
2. **Nth instance of a theme** — the change adds another instance of something that already exists 2+ times (another agent, another provider, another command, another handler). The incumbent pattern is about to be propagated.
3. **Shaky mirror** — a plan's `Mirror:` file (the sibling the executor is told to pattern-match) shows signs of debt: duplicated boilerplate per instance, hand-synced parallel lists, invariants enforced only by comments or convention.

Skip it for: trivial edits, bug fixes that don't add instances, doc changes, and changes that follow an incumbent pattern you can affirmatively call sustainable in one sentence (write that sentence in `## Pattern decisions` and move on — the section is still required, the analysis can be short).

## The procedure

### 1. Inventory the incumbent

Before judging, know what's actually there:

- **Count instances.** How many existing instances of the theme? (`grep`/`ast_grep`/serena for the signature shape.)
- **Read the newest and the oldest.** The oldest shows the original intent; the newest shows what the pattern has drifted into. Divergence between them is itself a finding.
- **Check what adding one instance touches.** Trace one recent instance through git history (`git log --follow`, the commit that added it): how many files did that commit touch for the one instance? That number is the pattern's marginal cost.

### 2. Sustainability test

Score the incumbent against these questions:

- **Mechanical Nth instance?** Could a cheap model add instance N+1 correctly given only an existing instance as reference? If adding one requires remembering to update K scattered places, the pattern fails this.
- **Invariants enforced or remembered?** Are the pattern's rules enforced by types, tests, or a completeness check (e.g. "adding an agent without a tier entry fails the build")? Convention-enforced invariants decay.
- **Does it survive 10×?** Picture 10× the current instance count. Does the pattern still work, or does a file become unmanageable / a switch statement become a liability / startup cost explode?
- **Is the abstraction earning its keep?** The inverse failure: a heavy abstraction with 2 instances that will never grow. Over-engineering is also an unsustainable pattern.

Classify: **sustainable** (passes all), **tolerable** (fails one, cost is contained), **unsustainable** (failing it compounds with every new instance).

### 3. Decide

| Incumbent | Decision | What it means |
|---|---|---|
| Sustainable | **Follow** | Match it faithfully. Consistency is now the dominant value. |
| Sustainable but doesn't cover the new case | **Extend** | Add the minimal new capability in the pattern's own style; don't fork a parallel mechanism. |
| Unsustainable, fix is small (≤ ~5 files, no behavior change) | **Replace now** | Fold the refactor into the plan as its own phase, *before* the phase that adds the new instance. The new instance then lands on the good pattern. |
| Unsustainable, fix is large | **Quarantine** | Build the new code on the better pattern behind a clear seam; do NOT add another instance of the bad pattern. Record the migration path for the old instances as explicit follow-up debt. |
| No incumbent (new concept) | **Set** | Design deliberately: pick the pattern that makes instance #2 mechanical. Steal the shape from the strongest analogous theme in this codebase before inventing one. |

Two hard rules:

- **Never silently propagate.** "Unsustainable, but I copied it anyway for consistency" is only acceptable as an *explicit, written* decision (a Quarantine call where even the seam is too expensive right now) — never as a default.
- **Never refactor silently either.** Replace-now means the refactor is *in the plan* with its own acceptance criteria, visible to the plan reviewer and the user — not an unplanned drive-by.

### 4. Write it down — `## Pattern decisions`

Every plan that triggered this skill gets a `## Pattern decisions` section:

```markdown
## Pattern decisions

### <theme or concept name>
- Incumbent: <pattern description + representative file:symbol, or "none (new concept)">
- Instances: <count>; adding one touches <K> files (evidence: <commit/file>)
- Classification: sustainable | tolerable | unsustainable — <one sentence why>
- Decision: follow | extend | replace-now | quarantine | set — <one sentence>
- Consequence: <what the executor must do differently from blind mirroring;
  for replace-now: which phase holds the refactor;
  for quarantine: where the seam is and what the migration debt is>
```

Short is fine. A sustainable-incumbent entry is 3 lines. The section existing at all is the point: it converts an implicit copy into an explicit decision that the plan reviewer can challenge and the executor can follow.

## Downstream effects (who reads the decision)

- **`@plan-reviewer`** rejects new-concept / Nth-instance plans without the section, and rejects "follow" decisions that show no evidence the incumbent was inspected.
- **`@build`** treats `Mirror:` files as hints subordinate to `## Pattern decisions`. When the two conflict, the pattern decision wins.
- **`@code-reviewer`** scores "Consistency" against the pattern decision first, the surrounding code second. Matching existing code is not a pass when the matched code is the pattern the plan flagged.
