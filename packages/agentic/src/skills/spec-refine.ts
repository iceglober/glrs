import type { SkillEntry } from "./index.js";

export function specRefine(): SkillEntry {
  return { "SKILL.md": `---
name: spec-refine
description: Interactive spec refinement. Walk through unknowns with the user, integrate answers, produce an updated spec with fewer unknowns. Use when user says 'refine this spec', 'resolve the unknowns', 'walk me through the questions', 'lets fill in the gaps'. Provide the spec file path.
disable-model-invocation: true
---

# /spec-refine — Interactive Spec Refinement

Walk through a product spec's unknowns with the user, integrate answers, and produce an updated spec with fewer unknowns.

Pipeline: \\\`/research-web\\\` -> \\\`/spec-make\\\` -> \\\`/spec-refine\\\` x N

---

## Input

The user provides a path to an existing spec file produced by \\\`/spec-make\\\`.

Example: \\\`/spec-refine research/dental-claims/spec-submission.md\\\`

Parse the spec path from \\\`$ARGUMENTS\\\`.

---

## Phase 1: Load and Assess

1. **Read the spec file.** Parse all UNKNOWN [U-xx] entries, [depends: U-xx] references, and OQ-xx Open Questions.
2. **Build a dependency map.** For each unknown: which requirements, business rules, KPIs, and open questions depend on it.
3. **Prioritize by blast radius.** Sort by number of downstream dependencies.
4. **Present the assessment** — total unknowns, open questions, blocked requirements, and the priority list with plain-language questions.

---

## Phase 2: Interactive Resolution

Walk through unknowns ONE AT A TIME, in priority order.

For each unknown:

1. **Ask a clear, answerable question.** Translate the unknown into plain language.
   - Bad: "What is the current encounter data model schema?"
   - Good: "Does your encounter model store procedure codes? If so, are they CPT codes, CDT codes, or a generic code field?"

2. **Wait for the user's response.** They may:
   - Answer fully -> mark RESOLVED
   - Answer partially -> narrow the remaining gap
   - Say "skip" or "don't know" -> leave as-is, move on
   - Provide info that changes the spec -> note the change
   - Ask a clarifying question back -> answer it, then re-ask

3. **After each answer, briefly state the impact** and immediately move to the next question.

4. **If an answer creates NEW unknowns**, note them.

5. **If an answer changes a requirement or rule**, note the change. Don't rewrite mid-conversation.

---

## Phase 3: Open Questions

After unknowns, present each Open Question as a decision:

"**OQ-03: Real-time or batched submission?**
Options: (A) always real-time, (B) always batch, (C) configurable.
Given what we've learned, [option X] seems most aligned. Preference?"

If decided -> convert to business rule or requirement.
If deferred -> leave as OQ.

---

## Phase 4: Generate Updated Spec

Once the user has answered what they can:

1. **Read the current spec in full.**
2. **Apply all changes:**
   - Resolved unknowns -> remove from register, embed facts in requirements, remove [depends: U-xx] tags
   - Partially resolved -> update the unknown, keep tags
   - New unknowns -> add to register with next U-number
   - Resolved OQs -> convert to BR-xx or R-xx
   - Changed requirements -> update text and MUST/SHOULD/COULD level

3. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. NEVER overwrite the previous version.

4. **Add a changelog** at the top:
   - What was resolved, partially resolved, newly discovered
   - Which OQs were decided
   - Which requirements changed
   - Remaining unknowns and open questions count

5. **Present a summary:** resolved count, remaining count, key changes, next steps, file path.

---

## Rules

1. **One question at a time.** Don't dump all unknowns at once.
2. **Translate, don't copy.** Plain language for the person in front of you.
3. **"Skip" is always valid.** Never pressure.
4. **Facts become requirements. Decisions become rules.**
5. **Never lose information.** Resolved unknowns become embedded facts.
6. **Version, don't overwrite.** Every pass produces a new file.
7. **New unknowns are progress.** More specific = more concrete.
8. **Stay in scope.** Don't pull out-of-scope items back in.
9. **Keep the pace.** Ask the next question immediately after stating impact.
` };
}
