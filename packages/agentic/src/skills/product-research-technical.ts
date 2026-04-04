export function productResearchTechnical(): string {
  return `---
name: product-research-technical
description: Use when researching technical feasibility by reading the codebase, when mapping existing capabilities and integration points, or when the team needs to know what exists before designing a solution
---

# Product Research — Technical

\`\`\`
THE IRON LAW: REPORT WHAT EXISTS, NOT WHAT SHOULD EXIST.
This is reconnaissance, not architecture. Map the terrain — don't redesign it.
\`\`\`

## Overview

Reads the codebase to map what exists, what's missing, and where integration points are. This is the ONLY research skill that looks INWARD at the codebase. The output is a factual inventory — not a design document.

## Process

### Step 0: Read the codebase, not your training data

Before writing anything:

1. **Read CLAUDE.md** — understand the project's architecture, stack, and conventions.
2. **Read actual source files.** Glob for entry points, scan directories, read imports. File names are not evidence — file contents are.
3. **Read configuration files.** \`package.json\`, \`tsconfig.json\`, env templates, docker configs. These reveal real dependencies and capabilities.

\`\`\`
HARD GATE: Every claim about "what exists" must cite a specific file and line.
"The codebase has user authentication" is worthless without:
"src/lib/auth.ts exports verifyToken() (line 42) using jose library"

If you can't point to a file, it doesn't exist. Do NOT infer capabilities from
project names, folder structures, or your knowledge of similar projects.
\`\`\`

### Step 1: Map what exists

Scan the codebase systematically. For each capability you find, record:

- **File path** — exact location
- **What it does** — from reading the code, not from the file name
- **External dependencies** — libraries, APIs, services it connects to
- **Data models** — what structures are defined, what fields they have
- **Exports** — what's available for other modules to use

\`\`\`
DO NOT:
- Infer capabilities from folder names ("there's a /billing folder so billing exists")
- Assume a dependency is used because it's in package.json (it might be unused)
- Claim something "could be extended" — report what IS, not what COULD BE
\`\`\`

### Step 2: Map what's missing

Based on the feature requirements and what you found in Step 1, identify gaps:

- **Capabilities the feature needs that don't exist anywhere in the codebase**
- **Partial implementations** — code that does something related but not what's needed (cite the file)
- **Missing dependencies** — libraries/services not currently used that the feature would require

\`\`\`
"MISSING" MEANS ABSENT FROM THE CODEBASE. NOT "MISSING FROM BEST PRACTICES."
Do not add items to the missing list because "production systems usually have" them.
If the feature doesn't need it, it's not missing.
\`\`\`

### Step 3: Map integration points

For each system boundary (internal or external):

| Field | What to report |
|-------|---------------|
| **System** | Name of the service/API/database |
| **Evidence** | File and line where the integration exists (or "NOT FOUND" if it doesn't) |
| **Direction** | Read, write, or both |
| **Auth mechanism** | How it authenticates (from code, not from docs) |
| **Data format** | What format data moves in (from code) |
| **Rate limits / constraints** | Only if documented in code or config. Do NOT import these from training data. |

### Step 4: Surface technical constraints

Report constraints you found IN THE CODE:

- Config values, environment variables, hardcoded limits
- Type constraints from TypeScript interfaces/types
- Build system constraints (bundler config, target runtime)
- Dependency version constraints from lock files

\`\`\`
CONSTRAINT MEANS: something the code currently enforces or depends on.
NOT: "best practice says you should also consider..."
If it's not in the code, it's not a constraint. It's speculation.
\`\`\`

### Step 5: List open engineering questions

Questions that only an engineer can answer by making a decision. Tag each:

- \`[CODEBASE]\` — answerable by reading more code (you may have missed something)
- \`[DECISION]\` — requires an engineering/architecture decision
- \`[EXTERNAL]\` — requires checking an external service's docs or capabilities

## Output Structure

**Output path:** \`docs/product/{slug}/research-technical.md\`

1. **What Exists** — Capabilities relevant to this feature, with file paths and line references.
2. **What We Need** — Gaps between what exists and what the feature requires. Each gap cites what was searched.
3. **Integration Map** — Table of system boundaries with evidence fields.
4. **Technical Constraints** — Constraints found in code/config, with file references.
5. **Open Engineering Questions** — Tagged questions for the team.

**Sections that do NOT belong:**
- Architecture recommendations ("you should use X pattern")
- Vendor comparisons or library recommendations
- Database schema designs
- API endpoint designs
- "Best practices" from training data
- Performance optimization suggestions
- Security recommendations beyond what the code already enforces
- "Future considerations"

## Red Flags — STOP

- About to write "you should" or "I recommend" — this is reconnaissance, not consulting. STOP.
- About to propose a database schema or API design — you're writing a tech spec. STOP.
- About to claim a capability exists without citing a file path — VERIFY by reading the code.
- About to recommend a library or vendor — out of scope. STOP.
- About to write "the system could be extended to" — report what IS, not what COULD BE. STOP.
- About to describe how Stripe/AWS/etc. works from training data — only report what's IN THE CODEBASE.
- About to add a section because "production systems typically need" it — not your call. STOP.
- About to list constraints you know from external docs but aren't in the code — those aren't constraints yet. Note them as \`[EXTERNAL]\` questions.
- Working from file names and directory structure without reading file contents — READ THE CODE.
- About to present a menu of next steps or ask "what would you like me to do next?" — just deliver the report.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll add architecture suggestions to be helpful" | Architecture is a separate artifact. This is reconnaissance. |
| "The folder structure implies this capability" | Folder names are not evidence. Read the files. |
| "It's in package.json so they have it" | Installed doesn't mean used. Search for actual imports. |
| "Production systems usually need rate limiting" | Report what exists. The team knows what they need. |
| "I know how Stripe webhooks work" | Report what the codebase does with webhooks, not how Stripe works. |
| "I'll note what could be extended" | Report what IS. Extensions are architecture decisions. |
| "Adding recommendations can't hurt" | Recommendations disguised as research become invisible assumptions. |
| "The team will want to know best practices" | The team wants to know what their codebase does. They know best practices. |
| "I should mention security considerations" | Only if the code already has security mechanisms to document. Don't import concerns from training data. |
| "I'll just quickly sketch the integration approach" | That's architecture. Deliver the map, not the route. |`;
}
