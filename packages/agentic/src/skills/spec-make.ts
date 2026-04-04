export function specMake(): string {
  return `---
description: Create a tight, actionable product spec from research output or a feature description. Strips narrative, defines terms, surfaces unknowns, questions KPIs. Use when user says 'create a spec', 'turn this into requirements', 'write a product spec', 'spec this out', 'spec from description'. Provide a research directory path OR a feature description.
---

# /spec-make — Create Product Spec

Create a tight, actionable product spec. Accepts either research output from \\\`/research-web\\\` or a direct feature description.

Pipeline: \\\`/research-web\\\` -> \\\`/spec-make\\\` -> \\\`/spec-refine\\\` x N

---

## Input

Parse \\\`$ARGUMENTS\\\` to determine the input mode:

### Mode A: From research directory
If the argument is a path to a directory (e.g., \\\`research/dental-claims\\\`):
1. Read every file in the directory — start with the synthesis, then each agent output
2. Extract scoping constraints from additional arguments

### Mode B: From description
If the argument is a text description (not a directory path):
1. Treat the entire argument as the feature/product description
2. Ask clarifying questions if the scope is ambiguous:
   - What's in scope vs. out of scope?
   - Who is the target user?
   - What are the key constraints?
3. Write output to \\\`specs/spec-[slug].md\\\`

In either mode, proceed to Phase 1 once you have the source material.

---

## Phase 1: Scope

1. **Build a mental model of what THIS spec covers.** Write it down in one sentence.
2. **Apply scoping constraints.** Out-of-scope items go to an "Out of Scope" section — not deleted, just fenced.

---

## Phase 2: Identify Unknowns

This is the most important phase. Source material makes assumptions. Your job is to find them.

**Types of unknowns:**
- **Platform** — data model, API capabilities, integration points, infrastructure
- **Domain** — domain-specific behaviors, edge cases, regional variations
- **Business** — build vs. buy, prioritization, pricing, go-to-market
- **Integration** — vendor API capabilities, timelines, constraints

**Format unknowns as open questions:**

\\\`\\\`\\\`
UNKNOWN [U-01]: Current encounter data model schema
  Assumed: Patient demographics, subscriber info exist
  Risk if wrong: Deeper refactoring than estimated
  Needed from: Engineering team — export current schema
  Blocks: Data model design, effort estimates
\\\`\\\`\\\`

Number every unknown (U-01, U-02, ...) so they can be referenced and tracked.

---

## Phase 3: Write the Spec

Write to: \\\`[research-dir]/spec-[scope-slug].md\\\` (Mode A) or \\\`specs/spec-[slug].md\\\` (Mode B)

### Structure:

1. **Header** — Status, Scope (one sentence), Out of scope, Date, Source (research dir or description)
2. **Unknowns Register** — All unknowns with assumed/risk/needed-from/blocks fields
3. **Definitions** — Every domain term defined precisely. No ambiguity.
4. **Requirements** — ID'd (R-01...), MUST/SHOULD/COULD, references unknowns with \\\`[depends: U-xx]\\\`
5. **Data Requirements** — What data, where from, what's missing
6. **Business Rules** — IF/THEN/ELSE with IDs (BR-01...), flag unknown dependencies
7. **KPIs and Targets** — Only what this scope can influence. Definition, target, confidence, measurement.
8. **Out of Scope** — Fenced with boundary context
9. **Open Questions** — Decisions to make (not facts to find). Options, dependencies, who decides.

---

## Phase 4: Refinement Passes

1. **Fat Trimming** — Remove anything that isn't a requirement, rule, unknown, or decision
2. **First Principles** — For every "must," ask "what breaks if we don't?" If nothing, it's a "should"
3. **Ambiguity Check** — Kill weasel words: "generally," "typically," "usually," "often," "may," "might." Convert to specific rules, unknowns, or delete.
4. **Unknown Cross-Reference** — Every requirement depending on an unknown gets \\\`[depends: U-xx]\\\`

---

## Critical Principles

1. **Unknowns are first-class citizens.** Top of the spec, not footnotes.
2. **Requirements, not solutions.** WHAT not HOW.
3. **No narrative.** Specs are reference documents, not stories.
4. **Define everything.** If a term could mean two things, define it.
5. **Scope is a weapon.** Enforce it aggressively — out-of-scope items get fenced, not deleted.
6. **Assumptions are risks.** Surface them, don't hide them.
7. **KPIs earn their place.** Measurable, actionable, attributable to this scope.
`;
}
