export function productResearchBenchmarks(): string {
  return `---
name: product-research-benchmarks
description: Use when researching industry benchmarks, KPIs, SLAs, or performance expectations for a product domain, when the user needs numbers to set targets, or when a discovery doc needs quantitative context
---

# Product Research — Benchmarks

\`\`\`
THE IRON LAW: BENCHMARKS ARE DATA, NOT DECISIONS.
"Industry average is X" does NOT mean "your target is X."
Provide the numbers. Let the human set the target.
\`\`\`

## Overview

Fully autonomous research of industry benchmarks, KPIs, SLAs, and performance expectations for a product domain. Produces the numbers a CTO needs to set targets without guessing. No user input needed after the initial domain is established.

## Process

### Step 0: Establish domain and scope

Read the user's request. You need exactly two things:
1. **Domain** — what product/service area (e.g., dental claim processing, payment gateway, CI/CD pipeline)
2. **Slug** — for the output path. Derive from domain if not provided.

If the domain is clear, proceed immediately. Do NOT interview the user — this skill is autonomous.

### Step 1: Dispatch research subagents

Launch **4 parallel subagents**, each focused on a different benchmark category:

**Subagent 1 — Hard Standards.** Regulatory requirements, contractual obligations, legal mandates. These are non-negotiable — miss them and you're non-compliant.
- Search for: regulations, compliance requirements, mandated SLAs, legal processing deadlines
- Tag each: regulation name, jurisdiction, effective date

**Subagent 2 — Industry Norms.** What the middle of the market actually delivers. Published benchmarks from analyst firms, industry associations, survey data.
- Search for: industry reports, benchmark surveys, association publications, analyst data
- Capture: median/average values, sample sizes, date of publication

**Subagent 3 — Best-in-Class.** What top performers achieve. Published case studies, vendor claims (flagged as such), award criteria.
- Search for: case studies, vendor benchmarks, performance awards, published SLAs from market leaders
- Distinguish: independently verified vs. vendor-claimed

**Subagent 4 — Minimum Viable.** The floor — below this, users won't adopt or will churn. User expectation surveys, review complaints, switching triggers.
- Search for: user satisfaction surveys, NPS drivers, churn analysis, review site complaints, switching cost studies
- Focus on: what causes users to leave or refuse to adopt

\`\`\`
EVERY SUBAGENT RECEIVES:
- The specific domain and scope
- Instruction: EVERY number must have a source (URL, report name, or regulation cite)
- Instruction: If you cannot find a sourced number, say "NO DATA FOUND" — do NOT estimate
- Instruction: Include publication date for every source — benchmarks decay
\`\`\`

### Step 2: Validate and deduplicate

Before assembly, review ALL subagent outputs:

\`\`\`
FOR EACH benchmark number:
  HAS SOURCE?
    YES → keep, verify source URL is real via web search
    NO  → REMOVE. No exceptions. No "reasonable estimates."

  DUPLICATE across subagents?
    YES → keep the one with the stronger source

  SOURCE DATE > 3 years old?
    YES → flag as [DATED] — still include, but warn
\`\`\`

### Step 3: Classify every benchmark

Every number gets exactly ONE tier tag:

| Tier | Meaning | Example |
|------|---------|---------|
| \`HARD STANDARD\` | Regulatory or contractual — non-negotiable | HIPAA: 30-day claim response mandate |
| \`INDUSTRY NORM\` | What the middle of the market delivers | Average claim processing: 14 days (CAQH 2024) |
| \`BEST-IN-CLASS\` | What top performers achieve | Automated adjudication: <24 hours (vendor case study) |
| \`MINIMUM VIABLE\` | Floor to be taken seriously | Users abandon after 30+ days (JD Power survey) |

\`\`\`
HARD RULE: If a number doesn't fit exactly one tier, you misunderstand it. Re-read the source.
HARD RULE: "INDUSTRY NORM" is not a recommendation. It is a data point.
\`\`\`

### Step 4: Assemble the benchmark document

**Structure:**

1. **Domain & Scope** — 2-3 sentences. What was researched and what was excluded.

2. **Benchmark Summary Table** — One table per KPI area. Columns:
   | KPI | Tier | Value | Source | Date | Confidence |
   - Confidence: \`HIGH\` (regulatory/large-sample survey), \`MEDIUM\` (analyst report/case study), \`LOW\` (single source/vendor claim)

3. **Hard Standards** — Regulatory and contractual requirements. Full citation. Jurisdiction. Non-negotiable.

4. **Industry Norms** — What the market delivers. Multiple sources where possible. Note variance and sample sizes.

5. **Best-in-Class** — Top performer data. Flag vendor claims vs. independent verification.

6. **Minimum Viable** — User expectation floor. What triggers churn or non-adoption.

7. **Data Gaps** — KPIs where no sourced benchmark was found. List what was searched for and where. Do NOT fill with estimates.

8. **Source Index** — Every source cited, with URL/reference, publication date, and type (regulation/survey/report/case study/vendor claim).

**Output path:** \`docs/product/{slug}/research-benchmarks.md\`

### Step 5: Final integrity check

Before writing the file, scan the entire document:

\`\`\`
FOR EACH number in the document:
  Can I trace it to a specific entry in the Source Index?
    NO → REMOVE the number. Replace with [NO DATA].

FOR EACH recommendation or target-setting language:
  Does any sentence say "you should", "we recommend", "target this"?
    YES → REWRITE as data: "Industry norm is X (source). Best-in-class is Y (source)."

FOR EACH gap:
  Did I fill it with a "reasonable default" or "common sense estimate"?
    YES → REMOVE. Replace with explicit [NO DATA FOUND] entry in Data Gaps.
\`\`\`

## What This Skill Does NOT Do

- Does NOT set YOUR targets — provides data for the human to decide
- Does NOT invent "reasonable defaults" — if a benchmark can't be sourced, it says so
- Does NOT do market sizing or trend analysis (separate research)
- Does NOT recommend vendors or solutions
- Does NOT present menus or ask "what next?"

## Red Flags — STOP

- About to write a number without a source citation — REMOVE it
- About to say "a reasonable target would be..." — you are making decisions. STOP. Present data only.
- About to fill a gap with "typically" or "generally" from training data — that is an invented benchmark. Say [NO DATA FOUND].
- About to recommend a tier as "the right target" — ALL tiers are data. The human picks.
- About to skip Data Gaps section because "we found enough" — gaps are as valuable as findings. Include them.
- About to use a source older than 5 years without flagging it — mark [DATED].
- About to present a vendor's marketing claim as an industry benchmark — flag it as \`vendor claim\` with LOW confidence.
- About to merge "what competitors do" with "what you should do" — these are different questions. Present data, not advice.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I know from training data that the industry average is X" | Training data is not a source. Find a published benchmark or say [NO DATA FOUND]. |
| "This is a reasonable estimate based on my knowledge" | Reasonable estimates are invented numbers. Source it or cut it. |
| "Industry average makes a good default target" | Industry average is the middle of the pack. The human decides if that's their target. |
| "I'll note it's approximate" | "Approximate" launders an invented number into looking sourced. Cut it. |
| "Best-in-class is obviously what they should aim for" | Best-in-class costs best-in-class resources. Present all tiers. Human decides. |
| "No data found looks like I failed" | No data found means you were honest. Invented data means you lied. |
| "The user wants numbers, not gaps" | The user wants REAL numbers. Gaps with honest [NO DATA] are more useful than fiction. |
| "I can extrapolate from adjacent domains" | Extrapolation is estimation. Flag it explicitly as [EXTRAPOLATED FROM: domain] or cut it. |
| "This vendor's SLA IS the industry standard" | One vendor's SLA is one vendor's SLA. It becomes a standard only with multiple sources. |
| "I should recommend which tier to target" | You are a researcher, not a strategist. Present the data. The CTO decides. |`;
}
