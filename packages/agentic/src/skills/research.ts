export function research(): string {
  return `---
description: Research orchestrator — plans workstreams, dispatches parallel research agents (local, web, or auto), reviews results, identifies gaps, and iterates until comprehensive. Use when user says 'research', '/research', 'investigate', 'deep dive', 'explore', 'understand how', 'what do we know about'. Provide the research topic and context.
---

# /research — Research Orchestrator

Multi-round research orchestrator that plans, dispatches, reviews, and iterates across research modes until the result is comprehensive.

**Research Query:** $ARGUMENTS

\`\`\`
THE IRON LAW: EVERY STEP IS A SUBAGENT. NO EXCEPTIONS.

You are an orchestrator. You do NOT research, synthesize, review, or analyze.
You launch subagents and pass their outputs to other subagents.
You use the Agent tool for ALL dispatches — never Skill tool.

Your jobs:
1. Launch a planning subagent
2. Dispatch research agents (which read skill files and follow them)
3. Launch a review subagent
4. If gaps exist, dispatch more research agents
5. Launch a synthesis subagent
6. Present the final result

You do NOTHING else. Every cognitive task is a subagent.
\`\`\`

## Execution Model

\`\`\`
CRITICAL — WHY AGENT TOOL, NOT SKILL TOOL:

Skill() runs the sub-skill in the main conversation. It dumps the full skill
instructions + all output into your context window. By the time you run a second
skill, you're out of context and the pipeline stalls.

Agent tool runs in a subprocess with its own context window. Each research agent
gets a fresh context, reads its skill file from .claude/commands/, and reports back.
The main conversation stays clean for orchestration.

DISPATCH TEMPLATE:
  Agent tool with prompt:
  "You are a research agent.

   ## Research Query
   {the full query or sub-question}

   ## Task
   1. Read .claude/commands/{skill-name}.md and follow every instruction
   2. {any additional context or constraints}
   3. Report back with your complete findings"

PARALLEL: Independent workstreams → ALL Agent calls in ONE message
SEQUENTIAL: Dependent workstreams → wait for prior agents
\`\`\`

If no query is provided as $ARGUMENTS, ask the user what they want to research.

## Phase 1: Plan — Subagent

Launch a **general-purpose subagent** to plan the research:

\`\`\`
PROMPT:
"You are a research planner. Given a research query, decompose it into workstreams
and classify each by research type.

Research Query: [QUERY]

For each workstream, provide:
1. A specific sub-question to answer
2. Classification: LOCAL, WEB, or AUTO
3. Why this classification (one sentence)
4. Dependencies: which other workstreams must complete first (if any)

Classification rules:
- LOCAL: Questions answerable from THIS codebase — architecture, data flow,
  patterns, implementations, file structure, dependencies within the repo
- WEB: Questions requiring external knowledge — best practices, competitor
  analysis, market research, industry standards, technology comparisons,
  regulatory info, documentation for external tools/libraries
- AUTO: ONLY when the query explicitly asks for experimentation with measurable
  outcomes and iterative trials. This is RARE. Most queries are LOCAL or WEB.

A single query often needs BOTH local and web workstreams. For example:
'How should we redesign our auth system?' needs LOCAL (how does it work now?)
AND WEB (what are current best practices?).

Output 3-6 workstreams. Prefer a mix of LOCAL and WEB when the query benefits.
Mark dependencies explicitly — independent workstreams will run in parallel."
\`\`\`

## Phase 2: Execute Round 1 — Parallel Agent Dispatches

From the plan, dispatch **one Agent per workstream**. Launch ALL independent workstreams in a SINGLE message.

\`\`\`
FOR EACH LOCAL WORKSTREAM:
  Agent tool:
  "You are a codebase research agent.

   ## Research Query
   {original query}

   ## Your Workstream
   {sub-question from plan}

   ## Task
   1. Read .claude/commands/research-local.md and follow every instruction
   2. Focus specifically on: {sub-question}
   3. Report back with your complete findings including all file:line references"

FOR EACH WEB WORKSTREAM:
  Agent tool:
  "You are a web research agent.

   ## Research Query
   {original query}

   ## Your Workstream
   {sub-question from plan}

   ## Task
   1. Read .claude/commands/research-web.md and follow every instruction
   2. Focus specifically on: {sub-question}
   3. Write your output to research/{slug}/{workstream-name}.md
   4. Report back with your complete findings including source URLs"

FOR EACH AUTO WORKSTREAM (rare):
  Agent tool:
  "You are an experimentation agent.

   ## Research Query
   {original query}

   ## Your Workstream
   {sub-question from plan}

   ## Task
   1. Read .claude/commands/research-auto.md and follow every instruction
   2. Focus specifically on: {sub-question}
   3. Report back with your findings and experiment results"

CRITICAL: ALL independent workstreams in ONE message.
Wait for ALL agents to complete before proceeding.
If workstream B depends on A, launch A first, wait, then launch B.
\`\`\`

## Phase 3: Review Round 1 — Subagent

Launch a **general-purpose subagent** to review all findings:

\`\`\`
PROMPT:
"You are a research reviewer. Given a research query and findings from multiple
parallel research agents, assess completeness and identify gaps.

Original Query: [QUERY]

Workstream Plan:
[PLAN FROM PHASE 1]

Findings from all agents:
[ALL RESULTS FROM PHASE 2]

Evaluate:
1. **Coverage** — Is every workstream adequately answered?
2. **Depth** — Are answers backed by specific evidence (file:line for local, URLs for web)?
3. **Connections** — Are cross-cutting themes identified? Do local and web findings
   inform each other?
4. **Contradictions** — Do any findings conflict? If so, which is more credible?
5. **Blind spots** — What aspects of the query weren't addressed by ANY workstream?

For each gap found, provide:
- What is missing
- Classification: LOCAL or WEB (where to look for the answer)
- Specific search guidance (file patterns, search terms, URLs to check)
- Why it matters for answering the original query

Output:
- VERDICT: COMPREHENSIVE or GAPS FOUND
- If GAPS FOUND: list each gap as a numbered, dispatchable research question with classification
- CROSS-CUTTING INSIGHTS: themes that span multiple workstreams (these feed synthesis)"
\`\`\`

## Phase 4: Execute Round 2 — Fill Gaps (If Needed)

If the review found gaps, dispatch **Agent tool calls for each gap** — ALL in ONE message.

Use the same dispatch templates from Phase 2, but with the gap question as the workstream and any relevant prior findings included as context.

\`\`\`
PROMPT ADDITION FOR GAP-FILLING AGENTS:
"## Context from Prior Research
{relevant findings from Round 1 that border this gap}

Focus on what the prior research missed. Don't repeat known findings."
\`\`\`

If COMPREHENSIVE, skip to Phase 5.

## Phase 5: Review Round 2 — Subagent (If Phase 4 Ran)

Launch another review subagent with the SAME prompt template as Phase 3, but now including Round 1 + Round 2 findings.

\`\`\`
ITERATION RULES:
- Maximum 3 total rounds of execute → review (Round 1 is mandatory)
- If still GAPS FOUND after Round 3, proceed to synthesis anyway — note remaining
  gaps as open questions
- Each round should have FEWER gaps than the previous. If gap count increases,
  stop iterating and proceed to synthesis.
\`\`\`

## Phase 6: Synthesize — Subagent

Launch a **general-purpose subagent** to produce the final synthesis:

\`\`\`
PROMPT:
"You are a research synthesizer. Combine findings from multiple research agents
into a single, authoritative document.

Original Query: [QUERY]

All Research Findings (all rounds):
[EVERY FINDING FROM ALL ROUNDS]

Cross-Cutting Insights from Reviews:
[INSIGHTS FROM PHASE 3/5 REVIEW AGENTS]

Create a comprehensive research report:

## Executive Summary
3-5 sentences answering the original query directly.

## Key Findings
Organized by theme (NOT by workstream). Each finding should:
- State the conclusion
- Cite evidence (file:line for local, URL for web)
- Note confidence level (high/medium/low based on evidence strength)

## Architecture & Code (if local research was involved)
How the relevant code is structured, with specific file:line references.

## External Context (if web research was involved)
Best practices, market context, competitor approaches — with source URLs.

## Connections
How local findings and external findings inform each other. Where the codebase
aligns with or diverges from industry standards/best practices.

## Recommendations
Actionable next steps based on the research. Each recommendation should cite
the finding that supports it.

## Open Questions
Anything that couldn't be fully resolved. Note whether it needs LOCAL exploration,
WEB research, or human input.

IMPORTANT: Organize by THEME, not by source agent. Merge overlapping findings.
Resolve contradictions explicitly. Every claim needs a citation."
\`\`\`

## Phase 7: Final Quality Gate — Subagent

Launch a **general-purpose subagent** to score the final report:

\`\`\`
PROMPT:
"You are a quality reviewer for research output. Score this report.

Original Query: [QUERY]
Final Report: [OUTPUT FROM PHASE 6]

Score 1-5 on each dimension:
1. **Answers the question** — Does the report directly address what was asked?
2. **Evidence quality** — Are claims backed by specific file:line or URL citations?
3. **Depth** — Does it go beyond surface-level to explain mechanisms and tradeoffs?
4. **Synthesis** — Are findings from different sources meaningfully connected?
5. **Actionability** — Could someone make decisions based on this report?

Overall: average of all dimensions.

If >= 4.0: 'QUALITY: PASS' with minor suggestions
If < 4.0: 'QUALITY: NEEDS WORK' with specific deficiencies framed as questions

Note: At this stage, the report is presented regardless of score. The score
helps the user gauge confidence."
\`\`\`

## Phase 8: Present

Present to the user:
1. The full synthesis report from Phase 6
2. Quality score from Phase 7
3. Research metadata: how many rounds, how many agents dispatched, modes used
4. If quality < 4.0, explicitly note which areas are weak and suggest follow-up commands

\`\`\`
DO NOT dump raw agent outputs. Only the synthesized report.
DO NOT ask "which section would you like to explore further?" — present everything.
DO suggest specific follow-up /research commands if open questions remain.
\`\`\`

## Subagent Summary

\`\`\`
MINIMUM SUBAGENTS PER RESEARCH (no gaps found):
  1 planner + 3-6 research agents + 1 reviewer + 1 synthesizer + 1 quality = 7-10

TYPICAL SUBAGENTS (one round of gap filling):
  1 planner + 4 research + 1 review + 2 gap-fill + 1 review + 1 synth + 1 quality = 11

MAXIMUM SUBAGENTS (three rounds):
  1 planner + 4 research + 1 review + 3 gap-fill + 1 review + 2 gap-fill + 1 review
  + 1 synth + 1 quality = 15

Each research agent internally spawns its OWN subagents (research-local spawns
8-14 Explore subagents, research-web spawns parallel web research agents).
Total subagent tree can be 30-50+ agents for a complex query. This is by design.
\`\`\`

## Red Flags — STOP

- About to use Skill() to invoke a sub-skill — USE AGENT TOOL
- About to research something yourself — LAUNCH A SUBAGENT
- About to synthesize findings yourself — LAUNCH A SYNTHESIS SUBAGENT
- About to skip the review phase — REVIEW IS MANDATORY AFTER EVERY ROUND
- About to skip the planning phase — THE PLANNER SUBAGENT DECIDES WORKSTREAMS
- About to launch research agents one at a time — ONE MESSAGE, ALL INDEPENDENT AGENTS
- About to present raw agent outputs — SYNTHESIZE FIRST
- About to decide "no gaps" without a review subagent — THE REVIEWER DECIDES, NOT YOU
- About to run a 4th round of gap filling — MAX 3 ROUNDS, THEN PRESENT

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll use Skill() — it's simpler" | Skill() eats main context. Agent tool keeps orchestration clean. |
| "I can plan the workstreams myself" | The planning subagent produces better decompositions with proper classification. |
| "One round of research is enough" | Review almost always finds gaps. The iterate-review loop is what makes research comprehensive. |
| "I'll skip the review — the findings look complete" | Your intuition is not a quality gate. The review subagent finds what you miss. |
| "I'll synthesize from the agent summaries" | A synthesis subagent with all findings produces better-connected, themed output. |
| "This only needs local research" | The planner subagent decides. Many queries benefit from both local and web context. |
| "I'll route to AUTO for thoroughness" | AUTO is for experimentation with measurable outcomes. Thoroughness comes from iteration, not AUTO. |
| "I'll launch agents sequentially to be safe" | Parallel is always faster. All independent workstreams in one message. |
| "The quality review is overhead" | The quality score tells the user how much to trust the report. 30 seconds well spent. |
`;
}
