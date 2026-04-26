import type { SkillEntry } from "./index.js";

export function productResearchDomain(): SkillEntry {
  return { "SKILL.md": `---
name: product-research-domain
description: Use when researching an unfamiliar product domain before discovery, when the team needs actionable domain knowledge to build, or when entering a regulated industry with standards and rules the system must encode
disable-model-invocation: true
---

# Product Research — Domain

\`\`\`
THE IRON LAW: PRODUCE A BUILD REFERENCE, NOT A DOMAIN TEXTBOOK.
If the team already operates in the domain, don't explain the domain to them.
Every section must answer: "What does an engineer need to know to build this?"
\`\`\`

## Overview

Fully autonomous domain research. Takes a product blurb and produces: how the industry works mechanically, regulations/standards the system must encode, terminology that carries legal or technical weight, the analog workflow being replaced, and domain-specific rules. No user input needed after the blurb.

## Process

### Step 0: Extract the noise filter

Before ANY research, parse the blurb for what the team already has/knows:

- **"We already..."** / **"we have..."** / **"existing..."** / **"live..."** — things they operate today
- **"We're building..."** / **"we want to..."** — things they DON'T have yet (research targets)

\`\`\`
NOISE FILTER = everything the team already operates.
Researchers MUST NOT explain things in the noise filter.

"We already process medical claims and want to add dental."
  NOISE: medical claims processing, claim lifecycle, payer relationships
  RESEARCH: dental-specific standards, dental procedure codes, dental claim differences
\`\`\`

If the blurb is too thin to build a noise filter (one sentence, no signals about what the team knows), STOP. Ask the user: "What do you already operate in this space? I need this to avoid explaining things you already know."

### Step 1: Dispatch research subagents

Launch **4 parallel subagents**, each receiving the noise filter:

**Subagent 1 — Standards & data formats.** Transaction formats, message schemas, code sets, version requirements. Field-level detail engineers need to serialize/deserialize. Skip formats the team already handles.

**Subagent 2 — Regulations & compliance rules.** Requirements the system MUST encode — filing deadlines, retention periods, required fields, penalty triggers, audit trail requirements. Specific statutes/rules, not summaries. Skip regulations the team already complies with.

**Subagent 3 — Analog workflow mapping.** What humans do today, step by step. Where the pain is. What can be automated vs what requires human judgment. Decision points. Handoff points. Time spent per step. THIS IS WHERE PRODUCT INSIGHT LIVES.

**Subagent 4 — Domain decision rules & error taxonomy.** Lookup tables, conditional logic the system must implement. Error codes, rejection reasons, status codes with exact meanings. Validation rules. Business rules that vary by category/type/region.

\`\`\`
EVERY SUBAGENT RECEIVES:
- Product scope from blurb
- NOISE FILTER: what the team already knows — DO NOT explain these
- Instruction: web-search to verify ALL specific claims
- Instruction: tag [VERIFIED] with source URL or [UNVERIFIED]
- Instruction: focus on ACTIONABLE specifics, not domain education
\`\`\`

### Step 2: Verify all specifics

After subagents return, audit their outputs:

1. **Every error code / status code** — web-search to verify meaning. Subagents hallucinate code definitions. Fix or remove.
2. **Every regulation citation** — verify statute/rule exists and says what the subagent claims. Wrong regulatory guidance is worse than none.
3. **Every data format claim** — verify field names, lengths, allowed values against official documentation.
4. **Every deadline/threshold** — verify exact numbers (filing windows, retention periods, penalty amounts).

\`\`\`
UNVERIFIABLE CLAIMS: If you cannot find a source after searching, mark [UNVERIFIED]
and note what you searched for. Do NOT present training-data claims as fact.
\`\`\`

### Step 3: Apply the noise filter — hard cut

Before assembly, read EVERY section through the noise filter:

\`\`\`
FOR EACH SECTION:
  "Would someone who already operates {noise filter items} need this?"
  YES → keep
  NO  → CUT. No exceptions. No "brief summary for context."

"The team processes medical claims" means:
  CUT: what a claim is, claim lifecycle, how adjudication works
  KEEP: how DENTAL claims differ from medical (delta only)
\`\`\`

### Step 4: Assemble the domain research doc

**Structure:**

1. **Domain Overview** — 3-5 sentences. What this domain is, mechanically. NOT education — just enough to frame the sections below.
2. **Standards & Data Formats** — Specific formats, schemas, code sets. Field-level where possible. Version requirements. Official spec references.
3. **Regulatory Requirements** — Rules the system must encode. Filing deadlines, retention, required fields, audit trails. Cite specific statutes/regulations.
4. **Analog Workflow** — Step-by-step current process. Time per step. Pain points. Automation potential per step. Decision points requiring human judgment.
5. **Domain Rules & Decision Logic** — Lookup tables, conditional rules, validation logic. Category-level with notes on where per-item rules exist.
6. **Error Taxonomy** — Error/rejection codes by stage. Exact meanings. Resolution paths. Retry vs terminal.
7. **Terminology That Matters** — ONLY terms that carry legal, technical, or business-rule weight. NOT a glossary of common domain terms. Max 15 entries.
8. **Open Questions** — Unknowns that need user input or deeper research. Tag: \`[USER]\` or \`[RESEARCH]\`.

**Output path:** \`docs/product/{slug}/research-domain.md\`

## Sections That DO NOT Belong

- Domain education for things the team already operates
- Market analysis, competitive landscape, TAM (separate research)
- Implementation recommendations (this is research, not a tech spec)
- Vendor evaluations or product recommendations
- History of the industry or how regulations evolved
- Generic best practices the team already follows
- "Getting Started" or onboarding content

## Red Flags — STOP

- About to explain what a claim/transaction/order IS to a team that processes them — CUT
- Writing a glossary of 20+ terms — most are noise. Keep only terms with legal/technical weight the team hasn't encountered.
- Section reads like a Wikipedia article — REWRITE as engineer-ready reference
- Including regulation history ("In 2010, Congress passed...") instead of current requirements — CUT the history, keep the rule
- Presenting training-data specifics (codes, deadlines, formats) without web verification — SEARCH FIRST
- About to write "it's important to understand..." — that's education, not reference. CUT.
- Analog workflow section is abstract ("stakeholders collaborate") instead of concrete ("clerk opens spreadsheet, copies row 3-7 into form") — REWRITE with specifics
- Domain overview exceeds 5 sentences — you're writing a textbook introduction. TRIM.
- Blurb is one sentence with no noise filter signals — STOP. Ask for context.
- About to present menus or ask "what should I research next?" — JUST DO THE RESEARCH

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Domain context helps engineers understand" | Engineers building in this domain already understand it. Write the delta. |
| "I'll be thorough and they can trim" | You're wasting their time. Filter before delivery. |
| "This regulation history explains why the rule exists" | They need the rule, not its origin story. |
| "I know this from training data, it's accurate" | Training data may be outdated or wrong. Web-verify specifics. |
| "A glossary helps standardize terminology" | Only if the terms carry weight they haven't seen. 5 terms, not 30. |
| "The analog workflow is obvious, I'll keep it brief" | The analog workflow is WHERE PRODUCT INSIGHT LIVES. Make it concrete and detailed. |
| "Including this can't hurt" | Every irrelevant section erodes trust and buries signal. |
| "I should explain the basics first" | The noise filter exists. If they already operate here, basics are noise. |
| "Market context frames the opportunity" | That's market research, not domain research. Separate skill. |
| "I'll just add a short summary of what they already have" | That's the noise filter talking. If they have it, don't explain it. |` };
}
