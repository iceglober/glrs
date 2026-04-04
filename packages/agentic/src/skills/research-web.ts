export function researchWeb(): string {
  return `---
description: Multi-agent research orchestrator. Decomposes a research question into parallel agent workstreams, launches them, monitors progress, and synthesizes results. Use when user says 'research this topic', 'I need to understand', 'deep dive into', 'investigate the market for', 'what do we know about'. Provide the research topic and context.
---

# /research-web — Multi-Agent Research Orchestrator

Decompose a research question into parallel agent workstreams, launch them, monitor progress, and synthesize results.

---

## Phase 1: Plan the Research

When the user asks to research something:

1. **Understand the question.** What exactly are we trying to learn? Who is it for? What decisions will it inform?

2. **Decompose into agent workstreams.** Each agent should have:
   - A clear, non-overlapping scope (e.g., "Market sizing & competitive landscape", "Technical feasibility & architecture", "Regulatory & compliance landscape")
   - 3-6 specific sections they must write
   - A target output length (~500-1500 lines of markdown per agent is the sweet spot)

3. **Plan the synthesis agent.** This runs AFTER all research agents complete. Its job is to read all agent outputs and produce a single coherent synthesis document with cross-cutting insights, contradictions, and recommendations.

4. **Present the plan to the user.** Format:

\\\`\\\`\\\`
## Research Plan: [Topic]

### Agent 1: [Name]
**Scope:** [1-2 sentence scope]
**Sections:**
1. [Section name]
2. [Section name]
3. ...
**Output file:** research/[topic]/[agent-name].md

### Agent 2: [Name]
...

### Synthesis Agent
**Runs after:** All research agents complete
**Output file:** research/[topic]/synthesis.md
\\\`\\\`\\\`

5. **Wait for user approval** before proceeding. Do NOT launch agents until the user confirms the plan.

---

## Phase 2: Create Skeleton Files

Once the user approves the plan:

1. **Create the output directory:** \\\`research/[topic]/\\\`

2. **For each research agent, create a skeleton markdown file** at the planned path. The skeleton MUST include:
   - Title, Status: IN PROGRESS, Last updated timestamp
   - Critical instructions block telling the agent to follow Search -> Edit -> Search -> Edit pattern
   - Numbered section headings with placeholder text

3. **Also create the synthesis skeleton** with similar critical instructions, but noting it should read from the other agent output files.

---

## Phase 3: Launch Research Agents

Launch ALL research agents in parallel using the Agent tool with \\\`run_in_background: true\\\`.

Each agent prompt MUST include:

1. **The research question and their specific scope** -- be precise about boundaries
2. **The exact file path they must write to** -- absolute path
3. **The section list they must complete** -- numbered, in order
4. **The critical write protocol** -- the agent MUST Edit its output file after EVERY SINGLE search or web fetch. Never two searches in a row without a write. Work through sections in order. Every number needs an inline source URL.
5. **Any relevant context files they should read first** -- provide absolute paths

**IMPORTANT:** Use \\\`run_in_background: true\\\` for all research agents so they run in parallel.

---

## Phase 4: Monitor Progress

Use escalating check-in intervals:

- **~30 seconds:** Verify agents have started writing
- **~2 minutes:** Check approximate progress (line counts, sections done)
- **~5 minutes:** Check for completion. **STUCK AGENT RULE:** If an agent's line count hasn't increased between two consecutive check-ins, stop it immediately and relaunch with pre-loaded data from its search results.
- **Every 5 minutes thereafter** until all agents complete.

Use \\\`wc -l\\\` via Bash for quick line count checks. Keep reports concise.

### Stuck Agent Recovery

1. Stop the agent immediately
2. Read the output file to see what sections are complete
3. Check the agent's process output for useful data it found but never wrote
4. Relaunch with a new agent that skips completed sections and has pre-loaded data

---

## Phase 5: Synthesis

Once ALL research agents are complete:

1. Launch the synthesis agent
2. It MUST read all research agent outputs, identify cross-cutting themes, contradictions, and gaps
3. Produce: executive summary, key findings by theme, contradictions, confidence assessment, recommended next steps
4. Follow the same write protocol (write after every read)

---

## Critical Rules

1. **Never launch agents without user approval of the plan.**
2. **Every agent gets the critical write protocol.** Non-negotiable — agent MUST Edit after EVERY search. Never two searches without a write.
3. **Kill stuck agents immediately.** They do NOT self-correct. Relaunch with pre-loaded data from prior search results.
4. **Source integrity.** Every number needs an inline URL.
5. **Monitor proactively** using escalating intervals. Don't wait for the user to ask.
6. **Keep check-in reports concise.**
`;
}
