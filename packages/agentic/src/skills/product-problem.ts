export function productProblem(): string {
  return `---
name: product-problem
description: Use when synthesizing research outputs into a problem definition, when bridging discovery research to requirements, or when the team needs a crisp problem statement before writing a PRD
---

# Product Problem Definition

\`\`\`
THE IRON LAW: SYNTHESIS IS COMPRESSION, NOT SUMMARY.
If your problem statement is longer than one sentence, you haven't found the problem yet.
If you have more than one success metric, you haven't found THE metric yet.
\`\`\`

## Overview

Reads all research outputs from \`docs/product/{slug}/research-*.md\` and produces a single problem definition file. The output is 1-2 pages max. This skill ONLY synthesizes existing research — it adds nothing new.

## Process

### Step 0: Read all research files

Read every file matching \`docs/product/{slug}/research-*.md\`. These are your ONLY inputs.

\`\`\`
HARD GATE: Do NOT proceed if no research files exist.
Do NOT supplement with training data, web searches, or domain knowledge.
If the research is thin, the problem definition will be thin. That's correct.
\`\`\`

### Step 1: Write the problem statement — ONE sentence

Customer-centric. Not system-centric. Not a paragraph. One sentence.

\`\`\`
CORRECT: "Small e-commerce merchants lose 12% of international orders
         because they can't display prices in the buyer's local currency."

WRONG:   "The system needs to support multi-currency pricing to enable
          international commerce capabilities across merchant storefronts."

WRONG:   "International e-commerce merchants face challenges with currency
          conversion, including exchange rate volatility, rounding rules,
          and regulatory compliance across jurisdictions."
          (That's three problems. Pick THE problem.)
\`\`\`

The test: Can a new team member read this sentence and explain what you're solving? If it requires a follow-up paragraph, compress harder.

### Step 2: Define the target user — ONE specific persona

Not "users." Not "merchants." Not "stakeholders." A specific person with a specific pain.

\`\`\`
CORRECT: "Mid-market Shopify merchants selling cross-border into LATAM,
          currently losing orders at checkout due to USD-only pricing."

WRONG:   "E-commerce merchants" (too broad — which ones? selling what? where?)
WRONG:   "Users of the platform" (not a person)
WRONG:   Three personas with a table (pick ONE primary user)
\`\`\`

### Step 3: Pick ONE success metric

The ONE number that proves the product worked. Not three. Not five. One.

\`\`\`
CORRECT: "Checkout completion rate for international orders increases from 54% to 70%."

WRONG:   "Increase conversion, reduce cart abandonment, improve NPS, grow international GMV."
          (That's four metrics. Which ONE matters most? Pick it.)

WRONG:   "Success will be measured across multiple dimensions including..."
          (No. One dimension. The one that matters.)
\`\`\`

If you cannot pick one, you haven't understood the problem well enough. Go back to Step 1.

### Step 4: Scope boundaries — what's IN and what's OUT (with WHY)

Every exclusion needs a reason. "Out of scope" without WHY is not a boundary — it's a dump.

\`\`\`
CORRECT:
  IN:  Display pricing in buyer's currency at checkout
  OUT: Real-time FX hedging — merchant absorbs rate risk for v1
       (WHY: hedging requires treasury integration we don't have)

WRONG:
  OUT: Real-time FX hedging (no reason given — will be re-litigated)
  OUT: Multi-language support (was this even related?)
\`\`\`

### Step 5: Non-goals with reasoning

Things we are INTENTIONALLY not solving, and WHY. Every non-goal must trace to a deliberate decision, not a dump of things that aren't the product.

\`\`\`
CORRECT: "We are not solving tax calculation — research shows merchants
          already use TaxJar/Avalara and consider this solved."

WRONG:   "Non-goals: tax, shipping, inventory, auth, logging, monitoring"
          (That's a list of random unrelated things, not deliberate exclusions)
\`\`\`

### Step 6: Write to output

**Output path:** \`docs/product/{slug}/problem.md\`

Structure:
1. **Problem** — one sentence
2. **Target User** — one specific persona
3. **Success Metric** — one measurable outcome
4. **Scope** — what's in, what's out with WHY
5. **Non-Goals** — intentional exclusions with reasoning

If the total output exceeds 2 pages, you haven't synthesized — you've summarized. Go back and compress.

## Red Flags — STOP

- Problem statement is more than one sentence — COMPRESS
- Problem uses "the system must" or "the platform should" — REWRITE as customer pain
- More than one success metric — PICK ONE
- Non-goal has no reasoning — ADD WHY or remove it
- About to add information not in the research files — STOP. Synthesis only.
- Output is longer than 2 pages — you're summarizing, not synthesizing. CUT.
- About to present a menu or ask "what should we focus on?" — YOU decide from the research
- About to web-search for additional context — STOP. The research is your only input.
- About to write "key challenges include..." followed by a list — that's a summary. Find THE challenge.
- Scope section lists everything from research as "in scope" — that's not scoping, that's copying

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The research covers multiple problems" | Your job is to find THE problem. Synthesis means choosing. |
| "One metric can't capture the full picture" | One metric forces clarity. If you need five, you don't understand the problem. |
| "I'll include multiple perspectives for completeness" | Completeness is the opposite of synthesis. Compress. |
| "The non-goals are obvious, they don't need reasoning" | Obvious to you. Without WHY, they get re-litigated every sprint. |
| "I should add context so the reader understands" | The research exists for context. This doc exists for decisions. |
| "This problem is genuinely complex — one sentence isn't enough" | Complex problems need simpler statements, not longer ones. |
| "I found relevant info while reading research — I should include it" | If it's not in the research files, it's not in the problem definition. |
| "The user might want to choose between options" | You're the synthesizer. Present the synthesis, not a menu. |
| "System-centric language is more precise" | Precise about the wrong thing. Customers don't care about systems. |
| "Two metrics would be more robust" | One metric that's wrong gets fixed. Five metrics hide the real one. |`;
}
