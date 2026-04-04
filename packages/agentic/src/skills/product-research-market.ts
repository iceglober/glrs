export function productResearchMarket(): string {
  return `---
name: product-research-market
description: Use when researching the market for a product area, when the user needs market sizing or pricing intelligence, when evaluating build/buy/partner decisions, or when a discovery doc needs market context
---

# Product Research — Market

\`\`\`
THE IRON LAW: EVERY CLAIM HAS A NUMBER. EVERY NUMBER HAS A SOURCE.
"The market is growing" is not research. "The market grew 23% YoY to \$4.2B in 2025 [SOURCE]" is research.
\`\`\`

## Overview

Fully autonomous market research. Takes a product blurb, dispatches parallel web search subagents, produces structured market intelligence. No user input needed after the blurb. Output is a decision-support document — not a market education course.

## Process

### Step 1: Extract research scope from blurb

Parse the blurb for:
- **Product category** — what market does this compete in?
- **Target segment** — enterprise, SMB, developer, consumer?
- **Known competitors** — any mentioned by name
- **Geographic scope** — global, US, regional?

If the blurb is too vague to identify a product category and target segment, STOP and ask. One clarifying message, not a drip-feed.

### Step 2: Dispatch research subagents

Launch **4 parallel subagents**, each with web search. Every subagent MUST web-search — training data is stale. Every subagent MUST write findings to its section of the output file after EVERY search. Never two searches without a write.

**Subagent 1 — Market Sizing & Growth.**
Search for: TAM/SAM/SOM estimates, market size reports, growth rates, analyst forecasts. Target specific numbers from named sources (Gartner, IDC, Grand View Research, etc.). If no reliable sizing exists, say so — do NOT fabricate ranges.

**Subagent 2 — Pricing & Business Models.**
Search for: how competitors price (per-seat, usage-based, flat-rate, freemium), typical price points, business model patterns (SaaS, open-core, marketplace, embedded), revenue models. Get SPECIFIC pricing pages and tiers from real products.

**Subagent 3 — Distribution & Go-to-Market.**
Search for: how products in this space acquire customers (PLG, sales-led, channel, marketplace listings), distribution channels, partnership patterns, developer relations strategies. Find specific examples of companies and their GTM motions.

**Subagent 4 — Trends & Signals.**
Search for: recent funding rounds in the space, acquisitions, product launches, technology shifts, regulatory changes. Focus on the last 12-18 months. Named companies, specific dates, dollar amounts.

\`\`\`
EVERY SUBAGENT RECEIVES:
- Product category and target segment
- Known competitors (if any)
- Geographic scope
- INSTRUCTION: Web-search FIRST. Training data is NOT acceptable as a primary source.
- INSTRUCTION: Tag every claim [VERIFIED] (web-sourced with URL) or [UNVERIFIED] (training data only).
- INSTRUCTION: Write to output file after EVERY search. Never two searches without a write.
\`\`\`

### Step 3: Assemble the research doc

<HARD-GATE>
Before including ANY claim, check: Does it have a number? Does the number have a source? If no, either find the source or tag [UNVERIFIED]. Generic claims without numbers get CUT.
</HARD-GATE>

**Structure:**

1. **Executive Summary** — 3-5 bullet points. Key numbers only. What a CTO needs in 30 seconds.

2. **Market Sizing** — TAM/SAM/SOM with sources and dates. Growth rate with source. If data is unreliable or unavailable, say so explicitly. Do NOT round training-data guesses into authoritative-looking ranges.

3. **Pricing Landscape** — Table format: Competitor | Model | Price Range | Notable Terms. Sourced from actual pricing pages.

4. **Business Model Patterns** — What models work in this space? Open-core vs SaaS vs embedded vs marketplace. Name companies using each model. Identify which pattern dominates and why.

5. **Distribution & GTM** — How do winners in this space acquire customers? PLG vs sales-led vs channel. Specific examples. What channels matter (marketplaces, integrations, communities).

6. **Recent Signals** — Funding, acquisitions, launches in last 12-18 months. Table: Company | Event | Date | Amount | Significance.

7. **Build/Buy/Partner Implications** — Based on the data above, what does the landscape suggest? Where are gaps? Where is the market crowded? What pricing expectations exist? This section synthesizes — every implication must trace to data above.

8. **Source Quality** — Confidence assessment. How many claims are [VERIFIED] vs [UNVERIFIED]? Which sections have weak sourcing? What follow-up research would strengthen the analysis?

**Output path:** \`docs/product/{slug}/research-market.md\`

## Sections That DO NOT Belong

- Domain education ("Code review is a practice where...")
- History of the industry
- Glossaries or terminology guides
- Generic strategy frameworks (Porter's Five Forces, SWOT)
- Competitor feature matrices (that's competitive analysis, separate skill)
- Technical architecture comparisons
- "The future of X" speculation without sourced signals

## Red Flags — STOP

- About to write "the market is growing" without a growth rate and source — STOP. Find the number or cut the claim.
- About to present a market size from training data without web verification — SEARCH FIRST.
- Writing a paragraph that explains what the product category IS — CUT. The user knows their domain.
- Including a strategy framework (SWOT, Porter's) — this is data collection, not strategy consulting.
- Competitor section is becoming a feature comparison — STOP. That's a different skill.
- Writing "estimated" or "approximately" without citing who estimated — you made it up. STOP.
- Section has no numbers, only qualitative claims — REWRITE or CUT.
- About to skip web search because training data seems sufficient — training data is stale. SEARCH.
- About to present a menu or ask "what areas would you like me to focus on?" — this skill is fully autonomous. Research ALL areas. Just do it.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I know this market from training data" | Training data market sizes are 1-3 years stale. Web-search or tag [UNVERIFIED]. |
| "Exact numbers aren't available" | Then say "no reliable public sizing found" — don't fabricate a range. |
| "Context helps the reader understand" | The reader is a CTO who operates in this space. Skip the education. |
| "A SWOT analysis would be valuable" | The user asked for market research, not a strategy exercise. Data first. |
| "I'll estimate conservatively" | Conservative guesses are still guesses. Source it or flag it. |
| "This competitor is well-known, no source needed" | Pricing changes. Funding happens. Revenue shifts. Verify current state. |
| "More detail is always better" | Every unsourced claim erodes trust in the sourced ones. |
| "I should explain the market dynamics" | Dynamics without numbers are opinions. Numbers with sources are research. |
| "Let me check what the user wants first" | The user wants market research. All 4 angles. No menu, no confirmation. |`;
}
