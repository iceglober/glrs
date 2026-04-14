import type { SkillEntry } from "./index.js";

export function specEnrich(): SkillEntry {
  return { "SKILL.md": `---
name: spec-enrich
description: Autonomous spec enrichment from codebase. Reads a product spec, researches the current repo to resolve unknowns, and produces an updated spec version — no user input needed. Use when user says 'enrich this spec from code', 'what can the codebase tell us', 'auto-resolve unknowns', 'research the repo for this spec'. Provide the spec file path.
disable-model-invocation: true
---

# /spec-enrich — Codebase-Driven Spec Enrichment

Read a product spec, research the current codebase to resolve unknowns, and produce an updated spec version autonomously — no user input required.

Pipeline: \\\`/research-web\\\` -> \\\`/spec-make\\\` -> \\\`/spec-enrich\\\` -> \\\`/spec-refine\\\` x N

Unlike \\\`/spec-refine\\\` (interactive, user answers questions), this skill is fully autonomous. It reads the repo to answer what the repo can answer, then hands off to the user for what it can't.

---

## Input

The user provides a path to an existing spec file.

Example: \\\`/spec-enrich research/dental-claims/spec-submission.md\\\`

Parse the spec path from \\\`$ARGUMENTS\\\`.

---

## Phase 1: Load Spec and Identify Researchable Unknowns

1. **Read the spec file in full.** Parse all UNKNOWN [U-xx] entries and their "Needed from" fields.

2. **Classify each unknown by researchability:**

   **Researchable from codebase** — the answer is in the repo:
   - Data model questions -> read schema files, migrations, models, types
   - API capabilities -> read route handlers, service files, SDK usage
   - Integration details -> read config, client libraries, API calls
   - Current workflow/lifecycle -> read state machines, event handlers, job runners
   - Provider/payer data -> read seed files, config tables, enums

   **Researchable from dependencies** — the answer is in installed packages or their docs:
   - SDK capabilities -> read node_modules types, package docs
   - Validation behavior -> read library source or config

   **NOT researchable** — requires human input:
   - Business decisions (pricing, prioritization, GTM)
   - Domain expertise (payer-specific rules, billing practices)
   - External vendor capabilities (requires contacting vendor)
   - Legal/compliance questions

3. **Plan the research.** For each researchable unknown, identify:
   - What to search for (file patterns, keywords, types)
   - Where to look (directories, specific files)
   - What would constitute a resolution vs. a partial answer

4. **Present the plan to the user:**

\\\`\\\`\\\`
## Enrichment Plan: [spec name]

**Total unknowns:** N
**Researchable from codebase:** N
**Researchable from dependencies:** N
**Requires human input (skipping):** N

### Will research:
1. [U-xx]: [title] — searching [what/where]
2. [U-xx]: [title] — searching [what/where]
...

### Skipping (not in codebase):
- [U-xx]: [title] — needs [who/what]
...

Proceeding with research.
\\\`\\\`\\\`

Do NOT wait for approval — proceed immediately after presenting the plan. This skill is meant to be autonomous.

---

## Phase 2: Research

Launch parallel research agents for independent unknowns. Use sequential research for unknowns that depend on each other.

### For each researchable unknown:

1. **Search the codebase** using Glob and Grep:
   - Schema/model files: \\\`**/*.prisma\\\`, \\\`**/models/**\\\`, \\\`**/schema.*\\\`, \\\`**/migrations/**\\\`, \\\`**/*.entity.*\\\`
   - Type definitions: \\\`**/*.d.ts\\\`, \\\`**/types/**\\\`, \\\`**/interfaces/**\\\`
   - API routes: \\\`**/routes/**\\\`, \\\`**/api/**\\\`, \\\`**/controllers/**\\\`
   - Config: \\\`**/*.config.*\\\`, \\\`**/.env.example\\\`, \\\`**/config/**\\\`
   - Services/integrations: \\\`**/services/**\\\`, \\\`**/integrations/**\\\`, \\\`**/clients/**\\\`
   - Search for keywords from the unknown (e.g., "encounter", "procedure", "npi", "stedi", "payer")

2. **Read relevant files** to understand the actual implementation.

3. **Record findings** with specific file:line references. Be precise:
   - "Found \\\`encounter\\\` table in \\\`prisma/schema.prisma:42\\\` with fields: patientId, providerId, dateOfService, status. No procedure-level fields."
   - NOT "The encounter model appears to have some fields."

4. **Classify the result:**
   - **RESOLVED** — found a definitive answer. Record the fact.
   - **PARTIALLY RESOLVED** — found relevant info that narrows the unknown. Record what's known and what remains.
   - **UNRESOLVABLE FROM CODE** — searched thoroughly, answer is not in the codebase. Reclassify as requires-human.

### Research strategies by unknown type:

**Data model unknowns:**
- Search for ORM models, schema files, migration files, database types
- Look for entity definitions, interfaces, and type aliases
- Check seed files for reference data (payer lists, code tables, etc.)

**Integration unknowns:**
- Search for SDK imports and client instantiation
- Read API call sites to understand what endpoints are used
- Check config/env for API keys, endpoints, feature flags

**Workflow unknowns:**
- Search for state machines, status enums, event handlers
- Read job/worker files for background processing patterns
- Check webhook handlers for inbound event processing

**Provider/configuration unknowns:**
- Search for provider tables, NPI fields, taxonomy references
- Check onboarding flows, admin UIs, setup scripts

---

## Phase 3: Generate Updated Spec

Apply the same rules as \\\`/spec-refine\\\` Phase 4:

1. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. Never overwrite.

2. **For resolved unknowns:**
   - Remove from Unknowns Register
   - Embed the discovered fact in the relevant section with file:line references
   - Remove \\\`[depends: U-xx]\\\` tags from unblocked requirements
   - Update requirements if the discovered reality changes them (e.g., a MUST becomes impossible, or a new constraint is discovered)

3. **For partially resolved unknowns:**
   - Update the "Known" and "Remaining gap" fields
   - Add file:line references for what was found
   - Keep \\\`[depends: U-xx]\\\` tags

4. **For new discoveries** that aren't tied to existing unknowns:
   - If the codebase reveals a constraint or capability the spec didn't account for, add it as a new requirement or update an existing one
   - If the codebase reveals a new unknown (e.g., "the encounter model exists but uses a custom ORM that may not support the needed queries"), add it to the register

5. **Add a changelog** at the top:

\\\`\\\`\\\`markdown
## Changelog

### v[N] — enriched from codebase (YYYY-MM-DD)
- Resolved from code: U-xx ([title] — [one-line finding with file ref])
- Partially resolved: U-xx ([what was found])
- New discoveries: [anything the codebase revealed that wasn't in the spec]
- Still requires human input: U-xx, U-xx, ...
- Remaining unknowns: N
\\\`\\\`\\\`

---

## Phase 4: Report

Present the results:

\\\`\\\`\\\`
## Enrichment Complete

**Researched:** N unknowns
**Resolved from codebase:** N
**Partially resolved:** N
**Not in codebase (needs human):** N
**New discoveries:** N

### Key findings:
- [most impactful facts discovered, with file references]

### Still needs human input:
- [U-xx]: [title] — [why it can't be answered from code]

Updated spec: [file path]
Run \\\`/spec-refine [new file path]\\\` to resolve remaining unknowns with the user.
\\\`\\\`\\\`

---

## Rules

1. **Be thorough but not exhaustive.** Search broadly first (Glob for patterns), then deep-read relevant files. Don't read every file in the repo.
2. **Cite everything.** Every fact from the codebase gets a file:line reference. The user should be able to verify any finding in 10 seconds.
3. **Don't guess.** If the code is ambiguous, record the ambiguity as a partial resolution, not a guess. "Found two possible encounter tables — \\\`encounters\\\` and \\\`clinical_encounters\\\` — unclear which is primary" is better than picking one.
4. **Respect scope.** Only research unknowns that are in the spec. Don't go exploring tangential topics.
5. **Preserve the spec structure.** The output must have the same sections as the input. Don't reorganize — just update content.
6. **Version, don't overwrite.** Always write a new file.
7. **The codebase is truth.** If the code contradicts the spec's assumption, the code wins. Update the spec accordingly and flag the discrepancy.
8. **Proceed without approval.** This skill is autonomous by design. Present the plan and immediately start researching.
` };
}
