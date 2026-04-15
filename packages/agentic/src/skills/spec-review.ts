import type { SkillEntry } from "./index.js";

export function specReview(): SkillEntry {
  return { "SKILL.md": `---
name: spec-review
description: Spec gap analysis after refinement. Reads the latest spec version, reviews all changes from prior versions, and identifies new gaps, inconsistencies, or opportunities revealed by resolved unknowns. Use when user says 'review this spec', 'audit the spec', 'find gaps', 'check for consistency', 'is this spec ready for engineering'. Provide the spec file path.
disable-model-invocation: true
---

# /spec-review — Spec Gap Analysis

Read the latest spec version, review the changelog of what's been resolved, and identify new gaps, inconsistencies, or opportunities that weren't visible before unknowns were resolved.

Pipeline: \\\`/research-web\\\` -> \\\`/spec-make\\\` -> \\\`/spec-enrich\\\` -> \\\`/spec-refine\\\` x N -> \\\`/spec-review\\\`

After multiple rounds of enrichment and refinement, a spec accumulates changes. Resolving unknowns can reveal new gaps — requirements that conflict, business rules that don't cover newly understood edge cases, or opportunities enabled by discoveries. This skill audits the spec with fresh eyes.

---

## Input

The user provides a path to the latest version of a spec file.

Example: \\\`/spec-review research/dental-claims/spec-submission-v4.md\\\`

Parse the spec path from \\\`$ARGUMENTS\\\`.

---

## Phase 1: Load and Reconstruct History

1. **Read the spec file in full.** Parse:
   - All sections: header, unknowns register, definitions, requirements, data requirements, business rules, KPIs, out of scope, open questions
   - The changelog — every version's changes

2. **Find prior versions.** Look in the same directory for earlier versions of this spec (\\\`-v1.md\\\`, \\\`-v2.md\\\`, or the unnumbered original). Read the oldest available version to understand the starting point.

3. **Build a change inventory.** From the changelogs and diffs between versions:
   - What unknowns were resolved, and how?
   - What requirements were added, modified, or re-leveled (MUST <-> SHOULD <-> COULD)?
   - What business rules were added or changed?
   - What new unknowns were introduced during refinement?
   - What open questions were decided?

---

## Phase 2: Gap Analysis

Work through each category systematically. For each, identify gaps the spec doesn't currently address.

### A. Consistency Audit

Check that resolved unknowns were fully propagated:

1. **Orphaned dependencies.** Search for \\\`[depends: U-xx]\\\` tags referencing unknowns that no longer exist in the register. These should have been cleaned up when the unknown was resolved.

2. **Stale assumptions.** For each resolved unknown, check whether its resolution invalidates assumptions elsewhere in the spec. Example: U-03 assumed a simple data model, but enrichment revealed a multi-tenant schema — do requirements still make sense?

3. **Definition drift.** Check the Definitions section against how terms are actually used in requirements and rules. Has a term's meaning shifted as unknowns were resolved?

4. **Requirement conflicts.** With unknowns resolved, do any requirements now contradict each other? Requirements that were compatible when vague may conflict when specific.

### B. Completeness Audit

Check whether resolved unknowns reveal work the spec doesn't account for:

1. **Unaddressed edge cases.** Resolved unknowns often reveal edge cases. Example: learning the encounter model supports multi-location practices means the spec needs to address location-scoping. Does it?

2. **Missing business rules.** For each resolved unknown that revealed complexity, check whether the business rules section covers the newly understood scenarios. IF/THEN/ELSE rules should exist for each decision point.

3. **Data requirement gaps.** Resolved data model unknowns may reveal fields, tables, or relationships the spec's data requirements section doesn't mention.

4. **KPI measurability.** With more known about the system, re-evaluate whether KPIs are actually measurable. A KPI that seemed measurable when abstract may not be with the real data model.

### C. Opportunity Scan

Check whether discoveries enable things the spec didn't consider:

1. **Capabilities discovered in enrichment.** Did the codebase reveal existing functionality the spec could leverage? Example: enrichment found an existing notification service — could it simplify a requirement?

2. **Simplification opportunities.** Do resolved unknowns make any requirements simpler than originally scoped? Requirements written around worst-case assumptions may be over-engineered given actual findings.

3. **Scope boundary shifts.** With new information, should anything move in or out of scope? Be cautious here — only flag clear cases, don't expand scope speculatively.

### D. Remaining Unknown Quality

Audit the unknowns that are still open:

1. **Stale unknowns.** Are any remaining unknowns answerable from information elsewhere in the spec? Sometimes resolving U-01 provides enough information to resolve U-12, but no one noticed.

2. **Unknown specificity.** Early unknowns are often broad ("what's the data model?"). After refinement, remaining unknowns should be narrow and specific. Flag any that are still too vague to be actionable.

3. **Missing unknowns.** Given everything that's been learned, are there unknowns that should exist but don't? New knowledge creates new questions.

---

## Phase 3: Generate Updated Spec

1. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. Never overwrite.

2. **Apply fixes for each finding:**

   **Consistency fixes:**
   - Remove orphaned \\\`[depends: U-xx]\\\` tags
   - Update requirements whose assumptions were invalidated
   - Correct definitions that drifted
   - Resolve requirement conflicts (flag to user if the resolution isn't clear-cut)

   **Completeness additions:**
   - Add requirements for discovered edge cases
   - Add business rules for new decision points
   - Update data requirements with newly understood fields/relationships
   - Update KPI measurability notes

   **Opportunity notes:**
   - Add a "## Opportunities" section (or update existing) noting capabilities that could simplify implementation
   - Adjust requirement complexity where discoveries enable simpler approaches
   - Flag scope boundary shifts as open questions if not clear-cut

   **Unknown updates:**
   - Resolve unknowns answerable from existing spec information
   - Split vague unknowns into specific sub-unknowns
   - Add newly identified unknowns with proper numbering

3. **Add a changelog entry:**

\\\`\\\`\\\`markdown
### v[N] — spec review (YYYY-MM-DD)
- Consistency: [what was fixed — orphaned tags, stale assumptions, conflicts]
- Completeness: [what was added — edge cases, rules, data requirements]
- Opportunities: [what was identified — simplifications, existing capabilities]
- Unknowns: [resolved N from existing info, split N into sub-unknowns, added N new]
- Remaining unknowns: N
- Remaining open questions: N
\\\`\\\`\\\`

---

## Phase 4: Report

\\\`\\\`\\\`
## Spec Review Complete

**Spec:** [file name]
**Versions reviewed:** [v1 through vN]
**Changes since original:** [summary count — resolved unknowns, new requirements, etc.]

### Consistency
- **Orphaned tags:** N fixed
- **Stale assumptions:** N found, N corrected
- **Requirement conflicts:** N found, N resolved

### Completeness
- **Edge cases added:** N
- **Business rules added:** N
- **Data requirements updated:** N

### Opportunities
- [1-3 most impactful findings]

### Unknowns
- **Resolved from existing info:** N
- **Split into sub-unknowns:** N
- **New unknowns added:** N
- **Remaining:** N unknowns, N open questions

Updated spec: [file path]

**Next step:**
- If new unknowns were added -> run \\\`/spec-enrich [new file]\\\` then \\\`/spec-refine [new file]\\\`
- If spec is clean -> ready for engineering (\\\`/think\\\` -> \\\`/work\\\`)
\\\`\\\`\\\`

---

## Rules

1. **Fresh eyes.** Read the spec as if seeing it for the first time. Don't assume prior versions were correct.
2. **Cite your reasoning.** For every gap identified, explain what resolved unknown or change created it.
3. **Don't expand scope.** Flag opportunities, don't act on them. The user decides what's in scope.
4. **Consistency over completeness.** A consistent spec with known gaps is better than an inconsistent spec that tries to cover everything.
5. **Version, don't overwrite.** Always write a new file.
6. **Respect the pipeline.** This skill audits — it doesn't replace enrichment or refinement. If new unknowns need human input, say so and point to \\\`/spec-refine\\\`.
7. **Be specific.** "Some requirements may conflict" is useless. "R-12 requires real-time submission but R-27 assumes batch processing" is actionable.
8. **Proceed autonomously.** Like \\\`/spec-enrich\\\`, this skill runs without waiting for approval. Present findings and the updated spec.
` };
}
