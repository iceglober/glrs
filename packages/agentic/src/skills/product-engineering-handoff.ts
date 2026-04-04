export function productEngineeringHandoff(): string {
  return `---
name: product-engineering-handoff
description: Use when extracting engineering questions and technical blockers from product docs for engineer review, when bridging product-to-engineering communication, or when the CTO needs an async handoff document
---

# Product Engineering Handoff

\`\`\`
THE IRON LAW: EXTRACT AND PRESENT, DON'T ANSWER.
Engineering questions need engineering answers.
Your job is to make the questions clear, not to resolve them.
\`\`\`

## Overview

Reads all product docs in \`docs/product/{slug}/\` and produces a handoff artifact containing every engineering-owned question, technical blocker, and open investigation item. Two modes: interactive (walk engineer through questions live) or async (produce a standalone document).

## Process

### Step 0: Read all product docs

Read every file in \`docs/product/{slug}/\`: discovery, problem, prd, acceptance — whatever exists. Do NOT skip files.

### Step 1: Extract everything engineering-owned

Scan every document for:
- Items tagged \`[ENGINEERING]\`
- Technical blockers in any Blockers section
- Open questions that require codebase investigation, architecture decisions, or feasibility assessment
- \`[DATA NEEDED]\` placeholders that only engineering can fill (SLAs, latency targets, capacity numbers)
- Requirements that reference systems, APIs, or integrations without confirmed feasibility

Collect them ALL before organizing. Do not filter, prioritize, or resolve any of them.

\`\`\`
EXTRACTION RULES:
- If tagged [ENGINEERING] → extract. No judgment.
- If tagged [USER] → skip. That's a product/business decision.
- If tagged [RESEARCH] → skip. That's answerable via web research.
- If ambiguous → extract and tag [TRIAGE] so the engineer can reclassify.
\`\`\`

### Step 2: Group by system/component

Group questions by the system or component they relate to — NOT by source document.

\`\`\`
GOOD: "Database & Storage", "External Integrations — Eaglesoft", "API Design"
BAD:  "From Discovery Doc", "From PRD Section 4", "From Acceptance Criteria"

The engineer thinks in systems, not in your document structure.
\`\`\`

### Step 3: Add context per question

For EACH question, include:
1. **The question itself** — clear, specific, answerable
2. **Why it matters** — what requirement or decision it blocks (1-2 sentences)
3. **Source** — which doc and section it came from (for traceability)

\`\`\`
CONTEXT CALIBRATION:
The engineer must be able to answer the question WITHOUT reading the full product docs.
But you are NOT summarizing the product docs — you are giving just enough context
to understand why this question exists and what depends on the answer.

TOO LITTLE: "Can we write back to Eaglesoft?"
JUST RIGHT: "Can we write back to Eaglesoft? The PRD requires claim status updates
             to appear in the practice management system (REQ-034). If write-back
             isn't feasible, the PRD needs a manual workflow alternative."
TOO MUCH:   [3 paragraphs about the dental claim submission lifecycle]
\`\`\`

### Step 4: Choose mode

Ask the user ONE question: **Interactive or async?**

Do not present a menu of options beyond this. Do not ask follow-up configuration questions.

#### Interactive mode

Walk through each question one at a time. For each:
1. Present the question with context
2. Wait for the engineer's answer
3. Write the answer back to the relevant product doc (update the tagged item, resolve the blocker)
4. Move to the next question

When all questions are answered, summarize what was resolved and what remains.

#### Async mode

Produce \`docs/product/{slug}/engineering-handoff.md\` with:
- Numbered questions grouped by system/component
- Context block per question (why it matters, what it blocks)
- Space for answers (engineer fills in later)
- A "Resolved" section at the bottom (initially empty)

The document must be self-contained. An engineer who has never read the product docs should understand every question well enough to answer it.

## What This Skill Does NOT Do

\`\`\`
YOU ARE A COURIER, NOT AN ARCHITECT.

BANNED: "Based on the requirements, I'd recommend using..."
BANNED: "The best approach for this would be..."
BANNED: "A common pattern for this is..."
BANNED: Making feasibility judgments ("this should be straightforward")
BANNED: Suggesting architecture, tech stack, or implementation approaches
BANNED: Resolving blockers by researching alternatives yourself
BANNED: Merging or rephrasing questions to "simplify" them (you'll lose signal)
BANNED: Filtering out questions you think are "obvious" to engineers

If you catch yourself typing a recommendation, DELETE IT.
The engineer hasn't seen the question yet. Don't pre-answer it.
\`\`\`

## Red Flags — STOP

- About to answer an engineering question with a recommendation — STOP. Extract it, don't resolve it.
- About to write "this should be feasible" or "this is straightforward" — STOP. You don't know that.
- About to produce an architecture doc or tech spec — STOP. Wrong artifact.
- About to group questions by source document — STOP. Group by system/component.
- About to skip a question because the answer seems obvious — STOP. Extract everything.
- About to suggest an alternative approach for a blocker — STOP. Present the blocker, let engineering decide.
- About to ask the engineer multiple setup questions before starting — STOP. One question: interactive or async.
- Presenting a question without context about what it blocks — STOP. Add the context.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I can answer this from my training data" | Training data answers are generic. This needs a codebase-specific answer. |
| "The answer is obvious to any engineer" | Then the engineer will answer it in 5 seconds. Still extract it. |
| "I'll suggest an approach to speed things up" | You'll anchor the engineer on your guess. Let them think fresh. |
| "Grouping by document is more traceable" | Traceability is in the source field. Grouping serves the reader. |
| "This question is too vague to extract" | Extract it as-is and tag [NEEDS CLARIFICATION]. Don't rewrite it. |
| "I should filter to the most important questions" | You don't know what's important to engineering. Extract all, let them triage. |
| "Adding my analysis makes the handoff more useful" | Adding your analysis makes the handoff your opinion. Engineers want raw questions. |
| "I'll merge similar questions to reduce noise" | Similar questions often have different blockers. Keep them separate. |`;
}
