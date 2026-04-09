export function researchLocal(): string {
  return `---
description: Deep codebase research using parallel Explore subagents. Decomposes a question about the local codebase into research tasks, launches parallel explorations, reviews for gaps, iterates, and synthesizes findings with specific file paths and line numbers. Use when user says 'how does X work in this codebase', 'where is Y implemented', 'trace the data flow for Z', 'what patterns does this repo use', 'explain the architecture of'. Provide the research topic as arguments.
---

# /research-local — Deep Codebase Research

Given a topic or question, deeply explore the codebase using subagents to produce a comprehensive understanding with specific code references.

**Research Topic:** $ARGUMENTS

\`\`\`
THE IRON LAW: YOU ARE AN ORCHESTRATOR ONLY. NO EXCEPTIONS.

Every phase is a subagent. Decomposition is a subagent. Exploration is subagents.
Gap analysis is a subagent. Synthesis is a subagent. Review is a subagent.

You NEVER use Glob, Grep, Read, or any exploration tool directly.
You NEVER synthesize, analyze, or review findings yourself.
You launch subagents and pass their outputs to other subagents.

Your ONLY job: decide which subagents to launch, write their prompts, and
pass results between them. That's it.
\`\`\`

If no topic is provided as $ARGUMENTS, ask the user what they want to research.

## Phase 1: Decompose — Subagent

Launch a **general-purpose subagent** to decompose the research topic:

\`\`\`
PROMPT:
"You are a research planner. Given a research topic about a codebase, decompose it
into 4-6 distinct, non-overlapping research questions that together would fully
answer the topic.

Research Topic: [TOPIC]

For each question, provide:
1. The specific question to answer
2. What aspects of the codebase to explore (file patterns, module names, concepts)
3. What a thorough answer would include (data flow, patterns, dependencies, etc.)

Output as a numbered list. Each question should be independently explorable.
Do NOT overlap — each question covers a unique facet of the topic."
\`\`\`

If the topic is too broad, the decomposition agent will produce too many questions. If it returns >6, ask the user to narrow the scope.

## Phase 2: Explore — Parallel Subagents

Launch **one Explore subagent per research question** from Phase 1 — ALL in a SINGLE message.

\`\`\`
PROMPT TEMPLATE (one per question):
"Research Topic: [ORIGINAL TOPIC]
Specific Question: [QUESTION FROM PHASE 1]

Thoroughly explore the codebase to answer this question. You must:

1. Search broadly first — glob for relevant files, grep for key terms
2. Read actual code — not just file names. Follow imports, trace call chains.
3. Go deep on critical paths — read functions line by line, understand logic

Provide a structured answer with:
- **Relevant Files**: Every file with full paths and line numbers for key code
- **Code Patterns**: Patterns, conventions, or idioms used
- **Data Flow**: How data moves through the relevant code paths
- **Dependencies**: What this code depends on and what depends on it
- **Key Insights**: Non-obvious findings, gotchas, important context

Be exhaustive. Read every file that could be relevant. Follow every import.
A file mentioned without a line number is incomplete."
\`\`\`

\`\`\`
CRITICAL: ALL Explore subagents launch in ONE message.
Minimum 4 subagents. Never fewer unless the decomposition produced fewer questions.
Do NOT launch them sequentially.
\`\`\`

## Phase 3: Gap Analysis — Subagent

Launch a **general-purpose subagent** to review findings and identify gaps:

\`\`\`
PROMPT:
"You are a research reviewer. Given a research topic and findings from multiple
parallel explorations, identify what's MISSING.

Research Topic: [TOPIC]

Research Questions Asked:
[LIST FROM PHASE 1]

Findings:
[ALL RESULTS FROM PHASE 2 EXPLORE SUBAGENTS]

Analyze the findings and identify:
1. **Unanswered questions** — aspects of the topic not adequately covered
2. **Shallow areas** — sections where files were mentioned but code wasn't read deeply
3. **Missing connections** — relationships between components that weren't traced
4. **Absent file references** — claims made without specific file:line references
5. **Cross-cutting gaps** — interactions between explored areas that weren't examined

For each gap, provide:
- What is missing
- Where to look (suggested file patterns, module names, search terms)
- Why it matters for understanding the topic

If the findings are comprehensive and no significant gaps exist, say 'NO GAPS FOUND'.
Otherwise, list each gap as a specific, explorable question."
\`\`\`

## Phase 4: Fill Gaps — Parallel Subagents (If Needed)

If Phase 3 found gaps, launch **Explore subagents** for each gap — ALL in a SINGLE message.

\`\`\`
PROMPT TEMPLATE (one per gap):
"Research Topic: [ORIGINAL TOPIC]
Specific Gap to Fill: [GAP FROM PHASE 3]

Context from prior research:
[RELEVANT PRIOR FINDINGS THAT BORDER THIS GAP]

Fill this specific gap in our understanding. Search the codebase thoroughly.
Provide file paths with line numbers for every finding.
Focus on what the prior research missed — don't repeat what's already known."
\`\`\`

If no gaps were found, skip directly to Phase 5.

## Phase 5: Synthesize — Subagent

Launch a **general-purpose subagent** to synthesize ALL findings (Phase 2 + Phase 4):

\`\`\`
PROMPT:
"You are a technical writer synthesizing codebase research. Combine all findings
into a single comprehensive document.

Research Topic: [TOPIC]

All Research Findings:
[EVERY FINDING FROM PHASE 2 AND PHASE 4]

Create a structured summary with these sections:

## Overview
A 2-3 sentence summary of what was learned.

## Architecture
Key components, their responsibilities, how they interact, design patterns used.

## Code Locations
Organized list of relevant files:
- Full paths with line numbers (format: path/to/file.ts:123)
- Brief description of what each file/section does
- Importance level (critical, important, reference)

## Data Flow
Entry points → transformations → exit points for the relevant system.

## Patterns & Conventions
Naming conventions, error handling, testing patterns observed.

## Dependencies
Internal (packages/modules) and external (npm packages, services).

## Gotchas & Edge Cases
Non-obvious findings, potential issues, tech debt, surprises.

## Related Areas
Parts of the codebase that relate but weren't the main focus.

## Open Questions
Things that couldn't be fully answered or need human clarification.

IMPORTANT: Every claim must reference a specific file:line. Remove any finding
that lacks a concrete code reference."
\`\`\`

## Phase 6: Quality Review — Subagent

Launch a **general-purpose subagent** to review the synthesis:

\`\`\`
PROMPT:
"You are a quality reviewer for codebase research. Given a research topic and a
synthesized report, evaluate its quality.

Research Topic: [TOPIC]
Synthesized Report: [OUTPUT FROM PHASE 5]

Score each dimension 1-5:
1. **Completeness** — Does it fully answer the research topic?
2. **Specificity** — Does every claim have a file:line reference?
3. **Accuracy** — Are the architectural descriptions consistent with the code locations?
4. **Depth** — Does it go beyond surface-level file listing to explain WHY and HOW?
5. **Actionability** — Could someone use this to confidently modify the code?

Overall score: average of all dimensions.

If overall score >= 4: Output 'QUALITY: PASS' and list any minor suggestions.
If overall score < 4: Output 'QUALITY: NEEDS WORK' and list specific deficiencies
that would need additional exploration to resolve. Frame each deficiency as a
specific, explorable question."
\`\`\`

**If NEEDS WORK:** Go back to Phase 4 — launch Explore subagents for the deficiencies, then re-synthesize (Phase 5) and re-review (Phase 6). Maximum 2 review iterations.

**If PASS:** Proceed to Phase 7.

## Phase 7: Report

Present the synthesized findings to the user:
1. The full structured report from Phase 5
2. A "quick reference" block of the 5-10 most important file paths
3. Quality score from Phase 6
4. Suggestions for follow-up research if any Open Questions remain

## Subagent Rules

\`\`\`
EVERY PHASE IS A SUBAGENT. THERE ARE NO EXCEPTIONS.

Phase 1 (Decompose):     1 general-purpose subagent
Phase 2 (Explore):       4-6 Explore subagents IN PARALLEL
Phase 3 (Gap Analysis):  1 general-purpose subagent
Phase 4 (Fill Gaps):     1+ Explore subagents IN PARALLEL (if gaps found)
Phase 5 (Synthesize):    1 general-purpose subagent
Phase 6 (Review):        1 general-purpose subagent
Phase 4-6 may repeat:    up to 2 iterations

Minimum subagent count for any research: 8 (decompose + 4 explore + gap + synth + review)
Typical subagent count: 10-14

PARALLELIZATION:
- ALL Explore subagents in a SINGLE message (Phase 2 and Phase 4)
- Sequential phases wait for prior phase to complete
- NEVER launch Phase 3 before ALL Phase 2 agents return
\`\`\`

## Red Flags — STOP

- About to use Glob, Grep, or Read directly — DELEGATE TO A SUBAGENT
- About to synthesize findings yourself — LAUNCH A SYNTHESIS SUBAGENT
- About to skip gap analysis — PHASE 3 IS MANDATORY
- About to skip quality review — PHASE 6 IS MANDATORY
- About to launch Explore subagents one at a time — ONE MESSAGE, ALL AGENTS
- About to report without running quality review — REVIEW FIRST
- About to decompose the topic yourself — LAUNCH A DECOMPOSITION SUBAGENT
- About to decide "no gaps" without a gap analysis subagent — THE SUBAGENT DECIDES, NOT YOU

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I already know where this code is" | You might be wrong. Launch an Explore subagent. |
| "I can synthesize this myself" | You are biased by what you expect. A synthesis subagent has fresh eyes. |
| "Gap analysis is overkill" | The first pass ALWAYS misses something. Phase 3 is mandatory. |
| "The quality is obviously fine" | Your intuition is not a quality gate. Launch the review subagent. |
| "One subagent is enough" | Minimum 4 Explore subagents. Parallel exploration finds what serial misses. |
| "I'll just do a quick grep to check" | You are an orchestrator. Every grep is an Explore subagent. |
| "Decomposition is simple enough to do myself" | The decomposition subagent produces better, non-overlapping questions. |
| "I'll save time by skipping the review" | Skipping review produces incomplete reports. The 2 minutes are worth it. |
`;
}
