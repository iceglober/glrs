export function productAcceptance(): string {
  return `---
name: product-acceptance
description: Use when a PRD is complete and the team needs product-level definition of done and acceptance criteria, when deciding what "ready to ship" means, or when defining success metrics for a feature
---

# Product Acceptance Criteria

\`\`\`
THE IRON LAW: ACCEPTANCE IS ABOUT THE USER, NOT THE SYSTEM.
"API validates NPI correctly" is a test case.
"First-submission acceptance rate exceeds 80%" is product acceptance.
One tells you the code works. The other tells you the product works.
\`\`\`

## Overview

Reads a PRD and its discovery doc to produce product-level acceptance criteria: what must be true before we ship, how we know it's working for users, and what quality standards we maintain. This is NOT per-requirement ACs (the PRD has those) — this is the product-level view.

## Process

### Step 0: Pre-flight

1. **Read \`docs/product/{slug}/prd.md\` completely.** This defines scope.
2. **Read \`docs/product/{slug}/discovery.md\`** for problem context and user pain points.
3. **Identify the slug** from existing docs or ask the user.

\`\`\`
HARD GATE: Do not write acceptance criteria for requirements that don't exist in the PRD.
The PRD is the scope boundary. If the PRD doesn't mention it, neither do you.
\`\`\`

### Step 1: Extract product outcomes

From the PRD and discovery doc, identify:
- **Who** the user is (from problem statement)
- **What pain** they have today (from discovery)
- **What "working" looks like** from the user's perspective (NOT the system's)

\`\`\`
WRONG: "System processes claims within 2 seconds"
RIGHT: "Providers receive claim status within one business day"

WRONG: "API returns 200 for valid requests"
RIGHT: "Users complete the workflow without needing to call support"

The system-level check is a test case. The product-level outcome is acceptance.
\`\`\`

### Step 2: Write three tiers

**Tier 1 — Launch Gate (binary, pre-launch)**

Minimum bar to ship. Each criterion is pass/fail, testable before launch.

- Tied to user-facing outcomes, not system internals
- Every criterion must be verifiable by a human or automated test BEFORE launch
- If any fails, do not ship

**Tier 2 — Success Criteria (measurable, post-launch)**

How we know the product is working for users. Each criterion has:
- A specific metric
- A target number WITH source (from discovery/PRD research, or \`[DATA NEEDED]\`)
- A timeframe for measurement
- A data source (how we'll measure it)

\`\`\`
HARD RULE: Do not invent benchmarks.
If the discovery doc or PRD contains research-backed numbers, use those.
If not, write [DATA NEEDED] and specify what research would answer it.
"Industry average is 73%" — WHERE? Cite or mark [DATA NEEDED].
\`\`\`

**Tier 3 — Quality Bar (ongoing, monitored)**

Standards the product must maintain continuously. Not one-time checks.
- Degradation triggers (what number means we have a problem)
- Monitoring approach (how we'll notice)

### Step 3: Write definition of done

A checklist of what must be true before we call this shipped. This is distinct from launch gate criteria — it includes process items:
- All launch gate criteria pass
- Documentation exists for [specific audiences from PRD]
- Monitoring is live for success criteria metrics
- Rollback plan exists

Keep it short. 5-10 items maximum.

### Step 4: Write output

**Output path:** \`docs/product/{slug}/acceptance.md\`

**Structure:**
1. **Product Outcome** — 2-3 sentences. What success looks like for the user.
2. **Launch Gate** — Binary pass/fail criteria. Table: criterion, verification method, status.
3. **Success Criteria** — Measurable post-launch metrics. Table: metric, target, timeframe, data source.
4. **Quality Bar** — Ongoing standards. Table: standard, degradation trigger, monitoring.
5. **Definition of Done** — Checklist.

**Length: 1-2 pages. Brevity is a feature.**

## What This Is NOT

- **Not per-requirement ACs** — the PRD has those. This is product-level.
- **Not a test plan** — engineering writes test plans. This defines what to test FOR.
- **Not a launch checklist** — launch checklists are operational (DNS, certs, rollout %). This is product (does it work for users?).
- **Not a metrics dashboard spec** — name the metrics, don't design the dashboard.

## Red Flags — STOP

- Writing "API returns 200" or "database query completes" — system-level. Rewrite as user outcome.
- Writing a test plan with test cases and expected responses — that's QA's job. STOP.
- Inventing a benchmark number without a source — mark \`[DATA NEEDED]\`. STOP.
- Adding criteria for features not in the PRD — scope creep. STOP.
- Document exceeding 2 pages — you're overspecifying. CUT.
- Writing operational launch steps (deploy to staging, run migrations) — that's a runbook. STOP.
- About to present a menu or ask "what would you like to do next?" — just deliver the doc. STOP.
- Writing per-requirement acceptance criteria — the PRD already has those. STOP.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "System-level criteria are more precise" | Precise about the wrong thing. Users don't care if the API returns 200. |
| "I should include test cases for completeness" | Test cases are engineering's job. You define what success looks like. |
| "I know the industry benchmark" | From your training data? Mark [DATA NEEDED] and let the team verify. |
| "More criteria means more thorough" | More criteria means more noise. 5 strong criteria beat 25 weak ones. |
| "I should add criteria for edge cases" | Edge cases are test cases. Product acceptance is about the common path working. |
| "This needs a Future Metrics section" | If it's not measurable at launch, it's not acceptance criteria. Cut it. |
| "The PRD doesn't have numbers so I'll estimate" | Then write [DATA NEEDED]. Estimates become invisible commitments. |
| "I should specify the monitoring tool" | That's implementation. Name the metric, not the tool. |`;
}
