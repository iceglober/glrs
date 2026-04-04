export function productRequirements(): string {
  return `---
name: product-requirements
description: Use when producing a tier-1 PRD from problem.md and research outputs, when the user wants outcome-grouped requirements instead of a requirements matrix, or when engineering needs a buildable requirements doc
---

# Product Requirements

\`\`\`
THE IRON LAW: REQUIREMENTS DESCRIBE OUTCOMES, NOT MECHANISMS.
"Practices submit claims without leaving their app" is a requirement.
"System validates NPI Type 1 vs Type 2" is an implementation detail.
Group by what the USER gets, not what the SYSTEM does.
\`\`\`

## Overview

Produces the PRD — the single aggregate document for a product. Reads ALL artifacts in \`docs/product/{slug}/\` (problem, research, acceptance, engineering handoff) and combines them into one authoritative reference. Individual artifacts still exist for deep dives, but the PRD is THE document. Modern format — requirements grouped by user outcome. No REQ-001 numbering.

## Process

### Step 0: Read inputs

1. **Read \`docs/product/{slug}/problem.md\` completely.** Extract: problem statement (one sentence), success metric (one number), non-goals, scope boundaries.
2. **Read ALL \`docs/product/{slug}/research-*.md\` files.** These are your scope boundary. Nothing outside them enters the PRD.
3. **Read \`docs/product/{slug}/acceptance.md\` if it exists.** This provides launch gates, success criteria, and quality bar.
4. **Read \`docs/product/{slug}/engineering-handoff.md\` if it exists.** This provides the engineering questions to include.
5. **Count open questions.** Questions tagged [USER] or [ENGINEERING] that affect requirements are BLOCKERS. Carry them forward — do not resolve them.

\`\`\`
THE PRD IS THE AGGREGATE. It incorporates key findings from EVERY artifact.
Individual artifacts are appendices. The PRD is the single document someone
reads to understand what we're building, why, for whom, what success looks like,
and what engineering needs to investigate.
\`\`\`

\`\`\`
HARD GATE: If problem.md doesn't exist or has no problem statement, STOP.
Ask the user. Do not invent the problem you're solving.
\`\`\`

### Step 1: Scope lock

The PRD covers EXACTLY what the research files cover. No more.

\`\`\`
BANNED:
- Features from your training data ("modern systems usually have...")
- "Future Considerations" that smuggle scope back in
- Requirements for things no research file mentions
- "Nice to have" lists sourced from domain knowledge

If it's not in the research, it's not in the PRD.
\`\`\`

### Step 2: Group by user outcome

For each cluster of related research findings, ask: **"What does the user GET from this?"**

That answer is the group heading. Not the system component. Not the data model. Not the API.

\`\`\`
CORRECT grouping (by user outcome):
  "Practices get paid without manual follow-up"
  "Patients see one bill regardless of provider count"
  "Admins resolve exceptions without engineering support"

WRONG grouping (by system component):
  "Claims Processing Engine"
  "Patient Billing Module"
  "Error Handling Subsystem"

WRONG grouping (by technical concern):
  "Data Validation Requirements"
  "Integration Requirements"
  "Performance Requirements"
\`\`\`

### Step 3: Write requirements as outcomes

Every requirement answers: "What is true for the user when this works?"

\`\`\`
CORRECT (outcome):
  "Practices submit claims without leaving their app."
  "Patients receive a single consolidated statement."
  "Failed claims surface in the admin queue within [DATA NEEDED] minutes."

WRONG (mechanism):
  "System validates NPI Type 1 vs Type 2 before submission."
  "API returns 422 with structured error payload on validation failure."
  "Database stores claim status with updated_at timestamp."

WRONG (ceremony):
  "The system must ensure that all claims are validated."
  "The system shall provide functionality for error handling."
  "System must support the ability to process claims."
\`\`\`

Vary the language. If every requirement starts with "System must..." you've written a compliance checklist, not a PRD.

### Step 4: Acceptance criteria

Every requirement gets an acceptance criterion that answers: **"How do we know this worked FOR THE USER?"**

\`\`\`
CORRECT (user-testable):
  "A practice submits a claim and sees confirmation without switching apps."
  "A patient with 3 providers receives one statement, not three."
  "An admin finds a failed claim in the exception queue and resolves it without filing a ticket."

WRONG (implementation-testable):
  "NPI validation returns correct error code for Type 1 vs Type 2."
  "Database query for claim status completes in under 200ms."
  "API endpoint returns 200 with valid JSON schema."
\`\`\`

Numbers in acceptance criteria MUST come from research files or the user. No number? Use [DATA NEEDED]. A placeholder forces a decision. A plausible guess buries one.

### Step 5: Assemble the PRD

Write the output to \`docs/product/{slug}/prd.md\` in this format:

\`\`\`markdown
# {Product Name} — PRD

## Problem
{One sentence from problem.md. Do not elaborate.}

## Success Metric
{One number from problem.md. If none exists, [DATA NEEDED].}

## User Story
{What changes for the user — not what the system does. 2-3 sentences max.}

## Market Context
{Key findings from research-market.md: TAM/SAM/SOM, pricing model,
distribution channel, structural tailwinds. 5-10 bullets max.
This is a SUMMARY — the full research is in research-market.md.}

## Competitive Position
{From research-competitive.md: key differentiators, gaps we exploit,
closest competitor. Include a condensed feature comparison table
(5-8 rows, our key advantages only). Full matrix in research-competitive.md.}

## Scope

**In scope:**
- {item} — {one-line reasoning from research}

**Out of scope:**
- {item} — {why, from problem.md non-goals}

## Requirements

### {User Outcome Group 1}

- {Requirement as outcome statement}
  - AC: {User-testable acceptance criterion}

- {Requirement as outcome statement}
  - AC: {User-testable acceptance criterion}

### {User Outcome Group 2}
...

## Domain Reference
{Key decision-rule tables from research-domain.md that requirements depend on.
Include the tables inline — payer routing rules, CDT-to-field matrix,
bundling rules, timely filing deadlines, failure taxonomy.
These are the lookup tables engineering will code against.
Full domain research in research-domain.md.}

## Benchmarks
{Key numbers from research-benchmarks.md that requirements and ACs reference.
Include the benchmark tiers (minimum viable, industry norm, best-in-class)
for the metrics that matter. Full benchmarks in research-benchmarks.md.}

## Acceptance Criteria & Definition of Done
{From acceptance.md if it exists. Three tiers:
1. Launch gates (binary, pre-launch)
2. Success criteria (measured post-launch)
3. Quality bar (ongoing)
Plus the definition-of-done checklist.
Full acceptance doc in acceptance.md.}

## Engineering Questions
{From engineering-handoff.md if it exists. All questions grouped by
system/component with context. This is what gets forwarded to engineering.
Full handoff doc in engineering-handoff.md.}

## Open Questions

- [USER] {question} — {impact if unresolved}
- [ENGINEERING] {question} — {impact if unresolved}

## Non-goals
{From problem.md. Do not add your own.}
\`\`\`

\`\`\`
THE PRD IS SELF-CONTAINED. Someone reading ONLY the PRD understands:
- What we're building and why (problem, user story, market, competitive position)
- What exactly to build (requirements with ACs)
- The domain rules the system must encode (domain reference tables)
- What good looks like (benchmarks, acceptance criteria)
- What engineering needs to investigate (engineering questions)
- What we're NOT building (scope, non-goals)

Individual research files are appendices for deep dives. The PRD is the document.
\`\`\`

## The Three Corruption Modes

### 1. Number fabrication

\`\`\`
[DATA NEEDED] IS MORE VALUABLE THAN A PLAUSIBLE GUESS.

BANNED: "99.9% uptime" / "sub-200ms" / "processes 80% of cases"
BANNED: Replacing [DATA NEEDED] with "reasonable defaults"
BANNED: "Industry standard is X" therefore our target is X

Where did that number come from? If you can't point to a research file
or a user statement, it's fabricated. Use [DATA NEEDED].
\`\`\`

### 2. Blocker laundering

\`\`\`
BLOCKERS NEED DECISIONS FROM PEOPLE, NOT ASSUMPTIONS FROM AI.

BANNED: "Assuming Eaglesoft supports write-back via API"
BANNED: Creating an "assumptions register" to make invention look rigorous
BANNED: Resolving [USER] questions with "best guess" answers

The ONLY way a blocker resolves:
- The USER decides -> write their decision as a requirement
- ENGINEERING investigates -> write the finding as a fact
\`\`\`

### 3. Scope creep

\`\`\`
IF IT'S NOT IN THE RESEARCH, IT'S NOT IN THE PRD.

BANNED: "We should also consider monitoring/alerting/audit trails"
BANNED: "For completeness, adding logging requirements"
BANNED: Requirements sourced from your domain knowledge

Research files are the scope boundary. Full stop.
\`\`\`

## Red Flags -- STOP

- About to number requirements REQ-001, REQ-002 -- you're writing a matrix. STOP. Group by outcome.
- About to write "System must..." for the fifth time -- you're writing a compliance doc. STOP. Vary language.
- About to add "Source: Discovery S4" citations on every line -- provenance clutter. STOP. The research files exist.
- About to group by "Data Validation" or "Error Handling" -- system-centric grouping. STOP. Group by user outcome.
- About to write a number you can't trace to research or the user -- fabrication. STOP. Use [DATA NEEDED].
- About to resolve an open question yourself -- blocker laundering. STOP. Carry it forward.
- About to add a requirement not in any research file -- scope creep. STOP.
- About to specify a vendor, library, or architecture -- you're writing a tech spec. STOP.
- About to present a menu or ask "what would you like to do next?" -- just output the PRD. STOP.
- About to write acceptance criteria that test the SYSTEM instead of the USER experience -- wrong level. STOP.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "REQ-001 numbering makes requirements traceable" | Group headings and git blame are traceable. IDs add ceremony, not clarity. |
| "System must... is standard PRD language" | Standard doesn't mean good. Outcome language is clearer and shorter. |
| "I need to cite which research section each requirement came from" | The research files are right there. Inline citations clutter the doc. |
| "Grouping by component helps engineers find their section" | Engineers can read. User outcomes tell them WHY they're building, not just WHAT. |
| "I'll add monitoring requirements -- every production system needs them" | If it's not in the research, it's not in the PRD. Propose a research update. |
| "This AC needs a specific latency target to be testable" | Testable means unambiguous pass/fail. [DATA NEEDED] is unambiguous. 200ms from nowhere is not. |
| "I'll mark my additions as suggestions" | Suggestions become soft requirements. Out of scope means out. |
| "The user said comprehensive" | Comprehensive about the researched scope. Not comprehensive about the entire domain. |
| "I should ask what format they prefer" | The format is defined above. Just write it. |`;
}
