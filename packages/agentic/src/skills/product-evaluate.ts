import type { SkillEntry } from "./index.js";

export function productEvaluate(): SkillEntry {
  return { "SKILL.md": `---
name: product-evaluate
description: Use when evaluating a product artifact for quality, when the orchestrator needs to decide if an artifact needs rework, or when scoring a discovery doc, problem definition, PRD, or acceptance criteria against quality standards
disable-model-invocation: true
---

# Product Evaluate

\`\`\`
THE IRON LAW: EVALUATE, DON'T FIX. FLAG, DON'T FUDGE.
A "pass" on a weak artifact is worse than a "fail" on a strong one.
Your job is honest assessment, not diplomatic approval.
\`\`\`

## Overview

Reads a product artifact, detects its type, evaluates it against type-specific quality criteria, and produces a score with specific actionable feedback. Does NOT fix anything. The orchestrator decides what to re-run based on your evaluation.

## Process

### Step 0: Read the artifact and detect type

Read the file at the given path. Detect type from structure:

| Type | Detection Signal |
|------|-----------------|
| **Research** | \`research-*.md\` filename, [VERIFIED]/[UNVERIFIED] tags, web-sourced claims |
| **Problem definition** | \`problem.md\` filename, Problem/Target User/Success Metric/Scope/Non-Goals structure |
| **Requirements/PRD** | \`prd.md\` filename, REQ-* IDs, acceptance criteria, blockers section |
| **Discovery** | \`discovery.md\` filename, Rules & Requirements tables, Integration Inventory, Open Questions |

If the artifact doesn't match any type, state what you see and evaluate against general completeness only.

### Step 1: Evaluate against type-specific criteria

#### Research docs

| Criterion | Pass | Needs Work | Fail |
|-----------|------|------------|------|
| **Sourcing** | All claims [VERIFIED] or clearly marked [UNVERIFIED] | Some claims unmarked | Claims presented as fact with no verification tags |
| **Verifiable gaps** | No [UNVERIFIED] that could be web-searched | 1-3 [UNVERIFIED] that are web-searchable | 4+ [UNVERIFIED] that are clearly web-searchable |
| **Section depth** | All sections have specific data (tables, codes, rules) | 1-2 thin sections with only prose | Multiple sections that are prose summaries without specifics |
| **Noise filter** | No domain education for things the team operates | Minor domain explanation creep | Reads like a domain textbook, not a build reference |
| **Missing angles** | Covers failure modes, edge cases, and rules | Missing one angle | Missing multiple critical angles |

#### Problem definition

| Criterion | Pass | Needs Work | Fail |
|-----------|------|------------|------|
| **Problem statement** | One sentence, customer-centric | One sentence but system-centric, OR customer-centric but 2-3 sentences | Paragraph-length, or system-centric, or multiple problems crammed together |
| **Target user** | One specific persona with specific pain | Specific persona but pain is vague | "Users" / "merchants" / multiple personas |
| **Success metric** | Exactly one, measurable, has a number | One metric but not measurable or missing target number | Multiple metrics, or no metric, or "success across multiple dimensions" |
| **Non-goals** | Each has explicit reasoning (WHY excluded) | Some non-goals lack reasoning | Non-goals are a dump list with no reasoning, or missing entirely |
| **Scope boundaries** | IN and OUT with WHY for each exclusion | OUT items missing WHY | No scope boundaries, or everything is "in scope" |

#### Requirements/PRD

| Criterion | Pass | Needs Work | Fail |
|-----------|------|------------|------|
| **Outcome-based** | Requirements say WHAT, not HOW | Some requirements leak implementation | Requirements specify vendors, tech stack, or architecture |
| **Acceptance criteria** | Every requirement has testable ACs | Some requirements have vague ACs ("handles gracefully") | Requirements without ACs, or ACs that aren't testable |
| **Number sourcing** | Every number traces to discovery doc or user | 1-2 numbers without clear source | Invented percentages, SLAs, or metrics with no source |
| **Scope fidelity** | All requirements trace to discovery doc | 1-2 borderline additions | Requirements for things not in discovery scope |
| **Blocker integrity** | Open questions carried as [BLOCKER], not "resolved" via assumptions | Minor assumption creep | Blockers laundered into "documented assumptions" |

#### Acceptance criteria (standalone)

| Criterion | Pass | Needs Work | Fail |
|-----------|------|------------|------|
| **Binary launch gates** | Every gate is yes/no, pass/fail | Some gates are subjective ("good performance") | Gates require judgment calls or have no clear pass/fail |
| **Measurable metrics** | Specific numbers with measurement method | Numbers present but measurement method unclear | Vague targets ("improve conversion") or no numbers |
| **Product-level** | Criteria describe user/business outcomes | Mix of product and system concerns | Criteria are about system internals (cache hit rate, DB latency) |
| **Completeness** | Covers happy path, error cases, and edge cases | Missing error or edge case coverage | Only covers happy path |

### Step 2: Score the artifact

\`\`\`
SCORING RULES — NO DISCRETION:
- ANY criterion rated "Fail" → overall score is FAIL
- 3+ criteria rated "Needs Work" → overall score is NEEDS-WORK
- 1-2 criteria rated "Needs Work" → overall score is NEEDS-WORK
- ALL criteria rated "Pass" → overall score is PASS

There is no "Pass with minor notes." There is no "soft pass."
NEEDS-WORK means the artifact goes back for rework. Period.
\`\`\`

### Step 3: Produce specific feedback

For every criterion rated Needs Work or Fail, provide SPECIFIC feedback.

\`\`\`
SPECIFIC (correct):
  "Section 3 (Failure Taxonomy) has 4 [UNVERIFIED] claims about error codes
   that are web-searchable: Payer ID 12345 rejection code, ANSI X12 835
   remark codes, ERA denial reason codes, and clearinghouse timeout behavior."

VAGUE (wrong — this is diplomatic noise):
  "The failure taxonomy could be more thorough."
  "Some sections would benefit from additional research."
  "Consider strengthening the sourcing in several areas."

THE TEST: Can someone act on your feedback without re-reading the artifact?
If they need to re-read it to figure out what you mean, your feedback is vague.
\`\`\`

Each feedback item MUST include:
1. **Which section or requirement** (by name, number, or ID)
2. **What the specific issue is** (quote the problematic text if useful)
3. **Why it fails the criterion** (which rule it violates)

### Step 4: Output the evaluation and STOP

\`\`\`
## Evaluation: {artifact filename}

**Type:** {detected type}
**Score:** {PASS | NEEDS-WORK | FAIL}

### Criteria Ratings

| Criterion | Rating | Detail |
|-----------|--------|--------|
| {name}    | {Pass/Needs Work/Fail} | {one-line summary} |
| ...       | ...    | ...    |

### Findings

{numbered list of specific findings, one per criterion that isn't Pass}

### Recommended Actions

{what should be re-run to fix each finding — which skill, what focus}
\`\`\`

After outputting the evaluation: STOP. Do not fix anything. Do not ask what to do next. Do not present options.

## Red Flags — STOP

- About to soften a "Fail" to "Needs Work" because "it's mostly good" — STOP. Apply the criteria table. Fail is fail.
- About to fix an issue you found instead of flagging it — STOP. You are the evaluator, not the editor.
- About to write "could be stronger" or "consider improving" — STOP. Say WHAT is weak and WHERE.
- About to give a "Pass" to avoid triggering a rework cycle — STOP. A false pass wastes more time than an honest fail.
- About to skip a criterion because "it doesn't apply to this artifact" — STOP. If the artifact type has the criterion, evaluate it.
- About to present a menu or ask "what would you like me to do?" — STOP. Output the evaluation and stop.
- About to rewrite a section to show what "good" looks like — STOP. That's fixing. Flag the issue only.
- About to add "but overall this is a strong document" — STOP. The score speaks. Compliments dilute signal.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "It's 90% there, I'll pass it" | 90% means 10% needs work. Score: NEEDS-WORK. |
| "The issues are minor" | Minor issues compound. If they fail a criterion, they fail a criterion. |
| "I'll note it but still pass" | Notes on a pass get ignored. NEEDS-WORK gets acted on. |
| "Being too strict will frustrate the user" | Being too lenient ships weak artifacts. The user hired a quality gate, not a cheerleader. |
| "I'll fix this one thing since I see the issue" | You are the evaluator. Fixing is a different skill's job. |
| "This is good for a first draft" | The criteria don't have a "first draft" discount. Apply them as written. |
| "I should explain what good looks like" | Point to the criterion. The skill that fixes it knows what good looks like. |
| "Overall strong with room for improvement" | Diplomatic noise. Score it. List the findings. Stop. |
| "I'll give it a pass and mention areas to watch" | "Areas to watch" is a soft fail pretending to be a pass. Score honestly. |
| "The feedback might seem harsh" | Harsh feedback that's specific and actionable is a gift. Vague approval is waste. |` };
}
