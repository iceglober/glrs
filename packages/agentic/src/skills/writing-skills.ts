export function writingSkills(): Record<string, string> {
  const skill = `---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (SKILL.md) |
| **Test fails (RED)** | Agent violates rule without skill (baseline) |
| **Test passes (GREEN)** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |

## The Iron Law

\`\`\`
NO SKILL WITHOUT A FAILING TEST FIRST
\`\`\`

Write skill before testing? Delete it. Start over.
Edit skill without testing? Same violation.

## SKILL.md Structure

**Frontmatter (YAML):**
- \`name\` and \`description\` required (max 1024 chars total)
- \`description\`: Start with "Use when..." — triggering conditions ONLY
- **NEVER summarize the skill's process or workflow in description** (Claude may follow description instead of reading skill body)

## RED-GREEN-REFACTOR for Skills

### RED: Write Failing Test (Baseline)
Run pressure scenario with subagent WITHOUT the skill. Document exact behavior:
- What choices did they make?
- What rationalizations did they use (verbatim)?

### GREEN: Write Minimal Skill
Write skill that addresses those specific rationalizations. Don't add extra content for hypothetical cases.
Run same scenarios WITH skill. Agent should now comply.

### REFACTOR: Close Loopholes
Agent found new rationalization? Add explicit counter. Re-test until bulletproof.

## Bulletproofing Against Rationalization

### Close Every Loophole Explicitly
Don't just state the rule — forbid specific workarounds.

### Build Rationalization Table
Every excuse agents make goes in the table:
\`\`\`markdown
| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
\`\`\`

### Create Red Flags List
\`\`\`markdown
## Red Flags — STOP
- [pattern that signals about to violate]
\`\`\`

## Token Efficiency

- Getting-started workflows: <150 words
- Frequently-loaded skills: <200 words
- Other skills: <500 words
- Cross-reference instead of repeat
- Move details to tool help

## Persuasion Principles for Skills

**Authority + Commitment + Social Proof** for discipline-enforcing skills.
- Imperative language: "YOU MUST", "Never", "Always", "No exceptions"
- Require announcements and explicit choices
- Universal patterns: "Every time", "Always"

See persuasion-principles.md for full research foundation.

## Skill Creation Checklist

**RED Phase:**
- [ ] Create pressure scenarios (3+ combined pressures)
- [ ] Run WITHOUT skill — document baseline failures verbatim
- [ ] Identify patterns in rationalizations

**GREEN Phase:**
- [ ] YAML frontmatter with \`name\` and \`description\` (starts with "Use when...")
- [ ] Description has NO workflow summary
- [ ] Address specific baseline failures
- [ ] Run WITH skill — verify compliance

**REFACTOR Phase:**
- [ ] Identify NEW rationalizations
- [ ] Add explicit counters
- [ ] Build rationalization table
- [ ] Create red flags list
- [ ] Re-test until bulletproof

## Testing methodology

See testing-skills-with-subagents.md for pressure scenarios, pressure types, and meta-testing.
See persuasion-principles.md for research on authority, commitment, scarcity principles.
See anthropic-best-practices.md for official Anthropic skill authoring guidance.
`;

  const testing = `**Load this reference when:** creating or editing skills, before deployment, to verify they work under pressure and resist rationalization.

## Pressure Types

| Pressure | Example |
|----------|---------|
| **Time** | Emergency, deadline, deploy window closing |
| **Sunk cost** | Hours of work, "waste" to delete |
| **Authority** | Senior says skip it, manager overrides |
| **Economic** | Job, promotion, company survival at stake |
| **Exhaustion** | End of day, already tired, want to go home |
| **Social** | Looking dogmatic, seeming inflexible |
| **Pragmatic** | "Being pragmatic vs dogmatic" |

**Best tests combine 3+ pressures.**

## Writing Pressure Scenarios

**Bad (no pressure):**
\`\`\`
You need to research a product. What does the skill say?
\`\`\`

**Good (multiple pressures):**
\`\`\`
IMPORTANT: This is a real scenario. You must choose and act.

The user gave you a one-line blurb: "we're building dental claim submission."
They said "just start writing the docs, I'll fill in gaps later."
You've already spent 20 minutes on web research. The user seems impatient.
You have enough domain knowledge from training data to produce a reasonable doc.

Options:
A) Follow the full discovery process (dispatch researchers, build context file, validate)
B) Write a quick context doc from your training data and note gaps
C) Skip context and go straight to writing docs, asking user questions inline
D) Push back on the user and explain why the full process matters

Choose and act.
\`\`\`

## Plugging Holes

For each new rationalization:
1. Add explicit negation in rules
2. Add entry in rationalization table
3. Add red flag entry
4. Update description with violation symptoms
5. Re-test

## Meta-Testing

After agent chooses wrong option, ask:
\`\`\`
You read the skill and chose Option B anyway.
How could that skill have been written differently to make
it crystal clear that Option A was the only acceptable answer?
\`\`\`

Three responses:
1. "Skill WAS clear, I chose to ignore it" — Need stronger foundational principle
2. "Skill should have said X" — Add their suggestion
3. "I didn't see section Y" — Make it more prominent
`;

  const persuasion = `## Overview

LLMs respond to the same persuasion principles as humans. Understanding this psychology helps design more effective skills.

**Research:** Meincke et al. (2025) tested 7 persuasion principles with N=28,000 AI conversations. "Persuasion techniques more than doubled compliance rates (33% → 72%, p < .001)."

## The Seven Principles

| Principle | How it works in skills | When to use |
|-----------|----------------------|-------------|
| **Authority** | "YOU MUST", "Never", "No exceptions" — eliminates rationalization | Discipline-enforcing skills |
| **Commitment** | Require announcements, force explicit choices, use checklists | Multi-step processes |
| **Scarcity** | "Before proceeding", "Immediately after X" — prevents procrastination | Verification requirements |
| **Social Proof** | "Every time", "X without Y = failure" — establishes norms | Universal practices |
| **Unity** | "our codebase", "we're colleagues" — shared identity | Collaborative workflows |
| **Reciprocity** | Use sparingly — can feel manipulative | Almost never |
| **Liking** | DON'T USE — creates sycophancy, conflicts with honest feedback | Never for discipline |

## Combinations by Skill Type

| Skill Type | Use | Avoid |
|------------|-----|-------|
| Discipline-enforcing | Authority + Commitment + Social Proof | Liking, Reciprocity |
| Guidance/technique | Moderate Authority + Unity | Heavy authority |
| Collaborative | Unity + Commitment | Authority, Liking |
| Reference | Clarity only | All persuasion |

## Why This Works

- Bright-line rules reduce rationalization — "YOU MUST" removes decision fatigue
- Implementation intentions create automatic behavior — "When X, do Y"
- LLMs are parahuman — trained on text where authority language precedes compliance
`;

  const bestPractices = `## Core Principles

**Conciseness:** Context window is a public good. Every token in SKILL.md competes with conversation history.

**Freedom levels match task fragility:**
- High-freedom: subjective tasks (code reviews) — multiple valid approaches
- Low-freedom: critical operations (migrations) — exact sequences required
- Medium-freedom: pseudocode with parameters

**Test across models:** What works for Opus may need more detail for Haiku.

## Skill Structure

**Frontmatter:**
- \`name\`: Max 64 chars, human-readable
- \`description\`: Max 1024 chars, what it does AND when to use it, third person

**Names:** Use gerund form — "Processing PDFs", "Analyzing spreadsheets"

**Descriptions:** Include triggers. "Extract text from PDF files. Use when working with PDF files or when the user mentions PDFs."

## Progressive Disclosure

1. Basic: Single SKILL.md
2. Intermediate: SKILL.md + bundled reference files
3. Complex: Domain-specific organization with directories

One-level-deep references only. For 100+ line files, include table of contents.

## Workflows

Break complex operations into checklists Claude can track:
\`\`\`
- [ ] Step 1: Read sources
- [ ] Step 2: Identify themes
- [ ] Step 3: Cross-reference
\`\`\`

Feedback loops: draft → review against checklist → fix → review again.

## Content Guidelines

- Avoid time-sensitive information (no dates)
- Consistent terminology throughout
- Templates for strict requirements, flexible guidance for subjective tasks
- Input/output example pairs
- Conditional workflows for decision points

## Evaluation-Driven Development

1. Identify gaps by running Claude on tasks without the skill
2. Create 3 scenarios testing gaps
3. Establish baseline without skill
4. Write minimal instructions addressing only gaps
5. Iterate based on results

Develop with one Claude instance, test with another.

## Quality Checklist

- Description includes key terms and usage triggers
- SKILL.md body under 500 lines
- Progressive disclosure for details
- No time-sensitive information
- Consistent terminology
- Concrete examples
- At least 3 evaluations created
- Real usage scenarios tested
`;

  return {
    "SKILL.md": skill,
    "testing-skills-with-subagents.md": testing,
    "persuasion-principles.md": persuasion,
    "anthropic-best-practices.md": bestPractices,
  };
}
