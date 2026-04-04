export function productResearchCompetitive(): string {
  return `---
name: product-research-competitive
description: Use when analyzing competitors for a product idea, when comparing features against market alternatives, or when identifying competitive gaps to exploit
---

# Product Research — Competitive Analysis

\`\`\`
THE IRON LAW: NAME COMPETITORS. COMPARE FEATURES. FIND GAPS. THAT'S IT.
If you're writing "Company X is a leader in the space" without a feature comparison, you're producing fluff.
\`\`\`

## Overview

Fully autonomous competitive analysis from a product blurb. Produces a feature comparison matrix, gap analysis, pricing research, and differentiation strategy. No user input needed after the initial blurb. Output is tabular and actionable — not narrative.

## Process

### Step 0: Parse the blurb

Extract from the user's input:
- **What we're building** — core capabilities, scope boundaries
- **Known competitors** — any vendors the user mentioned by name
- **Known partners/vendors** — systems we integrate WITH (NOT competitors)
- **Distribution model** — how we reach customers (affects who competes with us)

\`\`\`
HARD GATE: If the blurb is one sentence with no product capabilities described,
STOP and ask for more detail. You cannot identify competitors without knowing
what we compete ON.
\`\`\`

### Step 1: Identify competitors via web research

Launch **2 parallel subagents**:

**Subagent 1 — Direct & incumbent competitors.** Search for products that do the same thing we're building. Find 5-10 named products with specific capabilities. For each: name, URL, one-line positioning, and which of our features they cover.

**Subagent 2 — Indirect & adjacent competitors.** Search for products in adjacent spaces that could expand into ours, or that solve the same user problem differently. Find 3-7. Same output format.

\`\`\`
EVERY SUBAGENT RECEIVES:
- What we're building (capabilities list)
- PARTNER LIST: these are NOT competitors — do not include them
- Research focus area
- OUTPUT FORMAT: name, URL, positioning, features covered — NOT paragraphs
\`\`\`

### Step 2: Tag each competitor

Classify every identified company:

| Tag | Meaning | Example |
|-----|---------|---------|
| \`DIRECT\` | Same product, same customer | Competitor building identical SaaS |
| \`INDIRECT\` | Adjacent product, could expand into our space | Platform that adds our feature |
| \`INCUMBENT\` | Established solution we're replacing | Legacy system or manual process |
| \`PARTNER\` | We integrate with them — NOT a competitor | Vendor whose API we consume |

\`\`\`
CRITICAL DISTINCTION:
  PARTNER = we USE their product/API. They are part of our stack.
  COMPETITOR = they compete for the same customer/budget.

  A company CANNOT be both. If we use their API, they are a PARTNER.
  If they compete with us, they are a COMPETITOR — even if they also have an API.
  
  NEVER recommend a COMPETITOR's product as an integration or solution.
  NEVER list a PARTNER as a competitive threat.
\`\`\`

### Step 3: Build the feature comparison matrix

Create a table comparing our planned capabilities against each DIRECT and INCUMBENT competitor.

\`\`\`
| Feature              | Us (planned) | Competitor A | Competitor B | Competitor C |
|----------------------|-------------|-------------|-------------|-------------|
| Feature 1            | Yes         | Yes         | No          | Partial     |
| Feature 2            | Yes         | No          | Yes         | Yes         |
| ...                  |             |             |             |             |
\`\`\`

Rules:
- **Every row must be a specific, named feature** — not "good UX" or "modern architecture"
- **Values are: Yes / No / Partial / Unknown** — not "industry-leading" or "best-in-class"
- **Source each cell.** If you can't verify from their website/docs, mark \`Unknown\`
- **Include features competitors have that we DON'T plan** — these are deliberate gaps we need to justify or reconsider

### Step 4: Research competitor pricing

For each DIRECT and INCUMBENT competitor, search for publicly available pricing:

| Competitor | Model | Entry Price | Mid Tier | Enterprise | Source |
|-----------|-------|------------|---------|-----------|--------|
| Comp A    | Per seat/mo | \$X | \$Y | Custom | pricing page URL |
| Comp B    | Usage-based | ... | ... | ... | ... |

\`\`\`
RULES:
- Only include PUBLICLY AVAILABLE pricing. Do not guess or estimate.
- If pricing is not public, write "Not public — sales-led" and move on.
- Do not fabricate pricing tiers or dollar amounts.
- Include the SOURCE URL for every price point.
\`\`\`

### Step 5: Gap analysis

Two sections:

**Gaps competitors DON'T cover (our opportunities):**
Features or capabilities none or few competitors offer. These are differentiation angles.

**Gaps WE don't cover (our risks):**
Features competitors have that we're not planning. For each, note: is this a deliberate exclusion or an oversight?

### Step 6: Assemble the output

**Output path:** \`docs/product/{slug}/research-competitive.md\`

**Structure:**
1. **Competitive Landscape Summary** — One paragraph. How many competitors found, how the market breaks down.
2. **Competitor Profiles** — For each competitor: name, URL, tag (DIRECT/INDIRECT/INCUMBENT), one-line positioning, key strengths, key weaknesses. Tabular.
3. **Feature Comparison Matrix** — The table from Step 3.
4. **Pricing Comparison** — The table from Step 4.
5. **Gap Analysis — Our Opportunities** — What competitors miss.
6. **Gap Analysis — Our Risks** — What competitors have that we don't.
7. **Differentiation Strategy** — Based on the gaps: where we should compete and where we should NOT compete. Specific to feature gaps found, not generic advice.
8. **Partner Inventory** — Systems we integrate with. Separate from competitive landscape. Brief.
9. **Research Confidence** — Per-competitor: how much we verified vs inferred. Flag any competitor where information was sparse.

## What This Skill Does NOT Produce

- Market sizing or TAM (that's market research)
- Industry trends or forecasts (that's market research)
- Domain education (that's discovery)
- Build requirements (that's a PRD)
- Vendor recommendations (we analyze competitors, we don't recommend them)
- "Competitive strategy" essays — output is tables and bullets, not narrative

## Red Flags — STOP

- About to write "X is a leader in the space" without specific features — REWRITE with feature comparison
- About to recommend a competitor's product as an integration — REWRITE. Name it as a competitor, explain what it does, explain why we compete with it
- About to list a partner/vendor as a competitor — CHECK the partner list from the blurb
- About to include market sizing or TAM — WRONG ARTIFACT. That's market research.
- About to write pricing without a source URL — either find the source or write "Not public"
- About to use subjective comparisons ("better UX", "more modern") — REWRITE with specific feature differences
- Feature matrix has rows like "Scalability" or "Reliability" — these are not features. Name specific capabilities.
- About to write a strategy section with generic advice ("focus on user experience") — REWRITE with specific gap-based recommendations
- Only found 2-3 direct competitors — did you search for INDIRECT and INCUMBENT? Search again.
- About to include a "Future Considerations" section — out of scope. Deliver what you found.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "They have an API so we could integrate" | Check the competitor list. If they compete with us, we don't integrate — we compete. |
| "I'll describe their market position instead of features" | Market position is fluff. Feature comparison is actionable. |
| "Pricing isn't public so I'll estimate" | Fabricated pricing is worse than no pricing. Write "Not public" and move on. |
| "I know this competitor from training data" | Training data may be outdated. Web-verify current features and pricing. |
| "I'll add market trends for context" | That's market research. This is competitive analysis. Different artifact. |
| "This competitor is too small to include" | Small competitors in your exact space are the most dangerous. Include them. |
| "I'll write a narrative comparison — tables are limiting" | Tables force specificity. Narratives hide vagueness. Use tables. |
| "I should note their funding/valuation" | Funding is market research. Compare features, not balance sheets. |
| "I'll recommend best practices from competitors" | You're here to find gaps, not copy competitors. |
| "Only 2 direct competitors exist" | Did you search for indirect competitors and incumbents? The manual process we're replacing IS a competitor. |`;
}
