export function productBuild(): string {
  return `---
name: product-build
description: Use when taking a product idea from blurb to buildable artifacts, when orchestrating the full PM workflow autonomously, or when the user wants research, problem definition, PRD, acceptance criteria, and engineering handoff produced end-to-end
---

# Product Build — Full Artifact Suite from Blurb

\`\`\`
THE IRON LAW: EVERY PIPELINE STEP IS A SUBAGENT. NO EXCEPTIONS.
Use the Agent tool for every non-interactive step. Use the Skill tool ONLY for the interview.
The user sees THREE things: blurb assessment, interview, final artifacts.
Everything between runs as agents — not in the main conversation.
\`\`\`

## Overview

Takes a product blurb and autonomously produces 10 artifacts via subagents: 5 research docs, problem definition, acceptance criteria, engineering handoff, and PRD. Each agent reads its skill file, executes, self-evaluates, and iterates — all outside the main conversation.

## Execution Model

\`\`\`
CRITICAL — THIS IS WHY THE PIPELINE EXISTS:

Running skills via Skill() in the main conversation KILLS the pipeline.
Each Skill() call dumps its full output into your context window.
By skill 3-4, you run out of context and the pipeline stalls.
The interview never happens. The PRD never gets built.

THE FIX: Every non-interactive step dispatches an Agent tool call.
- Agents run as subprocesses with their own context window.
- Agents read the skill file from .claude/commands/ and follow it.
- Agents self-evaluate using .claude/commands/product-evaluate.md.
- The main conversation stays clean for orchestration.

DISPATCH RULES:
- Independent steps → ALL Agent calls in ONE message (parallel)
- Dependent steps → wait for previous agents before launching next
- Interview → Skill tool in main conversation (needs user interaction)
- Final presentation → main conversation (needs to talk to user)
- Everything else → Agent tool

AGENT PROMPT TEMPLATE (adapt for each step):
  "You are a product {role} agent.

   ## Product Blurb
   {paste the FULL blurb — every detail the user provided}

   ## Task
   1. Read .claude/commands/{skill-name}.md and follow every instruction
   2. Write output to docs/product/{slug}/{output-file}.md
   3. After writing, read .claude/commands/product-evaluate.md
   4. Evaluate your output against those criteria
   5. If NEEDS-WORK or FAIL: revise based on feedback, re-evaluate (max 2 rounds)
   6. Report back: file path, final score, any [USER] gaps found"
\`\`\`

## Process

### Step 0: Assess the blurb (main conversation)

\`\`\`
MINIMUM VIABLE BLURB:
- What the product/feature IS (even one sentence)
- Who it's FOR (even implied)
- Why it MATTERS (even vaguely)

THIN BLURB (missing 2+ of above): Ask for more context in ONE message.
RICH BLURB: Proceed immediately. Do NOT confirm or summarize.
\`\`\`

Derive a slug (lowercase, hyphenated, 2-3 words). Create \`docs/product/{slug}/\` via Bash.

### Step 1: Parallel research — 5 Agent calls in ONE message

Launch ALL FIVE agents in a SINGLE message. Each agent reads its skill file, writes research, and self-evaluates.

\`\`\`
SEND ONE MESSAGE WITH 5 AGENT TOOL CALLS:

Agent 1 — Market:
  "You are a market research agent.

   ## Product Blurb
   {full blurb}

   ## Task
   1. Read .claude/commands/product-research-market.md and follow it
   2. Write output to docs/product/{slug}/research-market.md
   3. Read .claude/commands/product-evaluate.md and evaluate your output
   4. If NEEDS-WORK or FAIL: revise and re-evaluate (max 2 rounds)
   5. Report: file path, final score, [USER] gaps"

Agent 2 — Domain:    same pattern, product-research-domain.md
Agent 3 — Competitive: same pattern, product-research-competitive.md
Agent 4 — Technical:  same pattern, product-research-technical.md
Agent 5 — Benchmarks: same pattern, product-research-benchmarks.md

5 AGENTS. ONE MESSAGE. ZERO EXCEPTIONS.
Do NOT launch them one at a time.
Do NOT use Skill() — use Agent tool.
Do NOT paste skill file contents into prompts — agents read the files.
\`\`\`

Wait for all 5 to complete. Then proceed immediately to Step 2.

### Step 2: Stakeholder interview — Skill tool, main conversation

\`\`\`
THIS IS THE ONLY STEP THAT USES THE SKILL TOOL.
\`\`\`

Invoke \`Skill(/product-interview)\` in the main conversation. The interview requires user interaction — agents cannot do this.

The interview reads all research outputs, extracts [USER] gaps, and asks the user targeted questions. After it completes, research docs are updated with answers.

\`\`\`
Do NOT skip the interview because "research covers it."
Do NOT run the interview as an Agent — it needs user interaction.
\`\`\`

### Step 3: Problem synthesis — 1 Agent

Launch ONE agent:

\`\`\`
"You are a product strategist agent.

 ## Product Blurb
 {full blurb}

 ## Task
 1. Read .claude/commands/product-problem.md and follow it
 2. Read ALL docs/product/{slug}/research-*.md as inputs
 3. Write output to docs/product/{slug}/problem.md
 4. Read .claude/commands/product-evaluate.md and evaluate
 5. If NEEDS-WORK or FAIL: revise and re-evaluate (max 2 rounds)
 6. Report: file path, final score"
\`\`\`

Wait for completion.

### Step 4: Acceptance + Engineering handoff — 2 Agents in ONE message

Launch BOTH agents in a SINGLE message (they are independent):

\`\`\`
Agent A — Acceptance:
  "You are a product quality agent.

   ## Product Blurb
   {full blurb}

   ## Task
   1. Read .claude/commands/product-acceptance.md and follow it
   2. Read docs/product/{slug}/problem.md and research files as input
   3. Write output to docs/product/{slug}/acceptance.md
   4. Read .claude/commands/product-evaluate.md and evaluate
   5. If NEEDS-WORK or FAIL: revise and re-evaluate (max 2 rounds)"

Agent B — Engineering handoff:
  "You are a technical product agent.

   ## Product Blurb
   {full blurb}

   ## Task
   1. Read .claude/commands/product-engineering-handoff.md and follow it
   2. Read docs/product/{slug}/problem.md and research files as input
   3. Write output to docs/product/{slug}/engineering-handoff.md
   4. Read .claude/commands/product-evaluate.md and evaluate
   5. If NEEDS-WORK or FAIL: revise and re-evaluate (max 2 rounds)"
\`\`\`

Wait for both to complete.

### Step 5: PRD — 1 Agent (ALWAYS LAST)

Launch ONE agent:

\`\`\`
"You are a product requirements agent.

 ## Product Blurb
 {full blurb}

 ## Task
 1. Read .claude/commands/product-requirements.md and follow it
 2. Read ALL files in docs/product/{slug}/ as inputs
 3. Write output to docs/product/{slug}/prd.md
 4. Read .claude/commands/product-evaluate.md and evaluate
 5. If NEEDS-WORK or FAIL: revise and re-evaluate (max 2 rounds)"
\`\`\`

\`\`\`
THE PRD IS LAST BECAUSE IT AGGREGATES EVERYTHING.
Do NOT launch it before acceptance and handoff are done.
\`\`\`

Wait for completion.

### Step 6: Present final artifacts (main conversation)

Read all artifacts in \`docs/product/{slug}/\`. Present:

\`\`\`
"Here are your product artifacts in docs/product/{slug}/:

 **Problem:** {one-sentence problem statement from problem.md}
 **Target user:** {persona from problem.md}
 **Success metric:** {the ONE metric}

 **Artifacts produced:**
 - research-market.md — {one-line summary}
 - research-domain.md — {one-line summary}
 - research-competitive.md — {one-line summary}
 - research-technical.md — {one-line summary}
 - research-benchmarks.md — {one-line summary}
 - problem.md — problem definition
 - acceptance.md — launch gates and success criteria
 - engineering-handoff.md — {N questions for engineering}
 - prd.md — {N requirements across M outcome groups}

 **Known gaps:** {any [DEFERRED] or [USER] items that remain}

 Review the artifacts. Tell me what needs adjustment."

DO NOT dump full artifact contents.
DO NOT ask "which artifact would you like to review first?"
\`\`\`

If the user gives feedback, dispatch the appropriate agent to update, then re-present.

## Autonomous Execution Rules

\`\`\`
THESE ARE NON-NEGOTIABLE:

DO: Use Agent tool for EVERY non-interactive step.
DO: Launch parallel agents in a SINGLE message.
DO: Bundle self-evaluation into each agent's prompt.
DO: Use Skill tool ONLY for the interview (Step 2).
DO: Include the FULL blurb in every agent prompt.
DO: Chain steps without pausing for confirmation.

DO NOT: Use Skill() for research, problem, acceptance, handoff, or requirements.
DO NOT: Run ANY pipeline step in the main conversation (except interview + presentation).
DO NOT: Launch parallel agents in separate messages.
DO NOT: Create separate "evaluate" agents — each agent self-evaluates.
DO NOT: Paste skill file contents into agent prompts — agents read the file.
DO NOT: Present intermediate results or status updates between steps.
DO NOT: Stop after a step to ask "ready to continue?"
DO NOT: Skip the interview — research covers domain, interview covers their system.
\`\`\`

## Red Flags — STOP

- About to call Skill(/product-research-*) — USE AGENT TOOL, NOT SKILL TOOL
- About to call Skill(/product-problem) — USE AGENT TOOL, NOT SKILL TOOL
- About to launch research agents one at a time — ONE MESSAGE, 5 AGENTS
- About to run a pipeline step in the main conversation — AGENT TOOL
- About to skip self-evaluation in an agent prompt — EVERY AGENT SELF-EVALUATES
- About to skip the interview — USER COVERS THEIR SYSTEM, RESEARCH COVERS DOMAIN
- About to produce PRD before acceptance/handoff — PRD IS ALWAYS LAST
- About to present intermediate results — USER SEES BLURB, INTERVIEW, FINAL ONLY
- About to resolve a [USER] question yourself — THAT'S FOR THE INTERVIEW

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll use Skill() — it's simpler" | Skill() runs in main conversation, eats context, kills the pipeline. Agent tool is required. |
| "I'll launch agents one at a time to be safe" | Parallel agents in ONE message. Sequential launch wastes 4x the time. |
| "I'll run this step in the main conversation — it's small" | Every step in main conversation brings you closer to stalling. Agent tool. Always. |
| "I'll evaluate separately after each agent returns" | Each agent self-evaluates. No separate evaluate step needed. |
| "I should paste the skill content into the agent prompt" | Agents read .claude/commands/. Don't duplicate 100+ lines into prompts. |
| "The interview can run as an agent" | Agents can't talk to users. Interview is Skill tool in main conversation. |
| "Research looks good, I'll skip evaluation" | Your intuition is not a quality gate. Agents self-evaluate via product-evaluate.md. |
| "I'll skip the interview — research is comprehensive" | Research covers domain. Interview covers their system, constraints, preferences. |
| "Let me present research findings before continuing" | User sees: blurb assessment, interview, final artifacts. Nothing between. |
| "I should explain my process" | Execute, don't explain. The artifacts speak for themselves. |`;
}
