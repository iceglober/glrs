export function productInterview(): string {
  return `---
name: product-interview
description: Use when research is complete and you need stakeholder answers for gaps tagged [USER] in research docs, when filling specific unknowns that only the user can answer, or when conducting a focused 10-15 minute interview after autonomous research
---

# Product Interview — Targeted Gap-Filler

\`\`\`
THE IRON LAW: THE INTERVIEW IS A GAP-FILLER, NOT A DISCOVERY SESSION.
Research covers the domain. You cover THEIR system.
If you could have found the answer via web search, you wasted their time.
\`\`\`

## Overview

Reads all research outputs, extracts questions tagged [USER], and conducts a focused interview that asks ONLY what research couldn't answer. This is a 10-15 minute session, not a 45-minute domain audit.

## Process

### Step 0: Load research and extract [USER] gaps

Read ALL files in \`docs/product/{slug}/\`:
- \`research-domain.md\`, \`research-market.md\`, \`research-competitive.md\`
- \`problem.md\`, \`discovery.md\` (if they exist)

Extract every question tagged \`[USER]\`. Also extract facts tagged \`[UNVERIFIED]\` that the user could confirm faster than another web search.

\`\`\`
HARD GATE: If there are ZERO [USER] questions across all research docs,
tell the user: "Research didn't flag any stakeholder-dependent unknowns.
If you have context to add, tell me what — otherwise we can proceed to discovery."
Do NOT invent questions to justify an interview.
\`\`\`

### Step 1: Filter out questions research could answer

Before presenting ANY question, check:

\`\`\`
FOR EACH [USER] QUESTION:
  "Could I answer this with a web search?"
  YES → DO NOT ASK. Research it yourself or flag for /product-discovery-refine.
  NO  → Keep. This is a real stakeholder question.

REAL STAKEHOLDER QUESTIONS (examples):
  - "Which payers do you currently have contracts with?"
  - "What's your current monthly claim volume?"
  - "Who owns the integration with PartnerX — your team or theirs?"
  - "You mentioned a dedup layer — how does it actually work in your system?"

NOT STAKEHOLDER QUESTIONS (research could answer):
  - "What's the standard format for dental claims?"
  - "How does ERA 835 remittance work?"
  - "What are common rejection codes?"
\`\`\`

### Step 2: Group by topic, present in batches of 3-5

Group remaining questions by topic area. Present ONE batch at a time.

\`\`\`
BATCH SIZE: 3-5 questions per turn. Not one at a time (too slow).
Not all at once (overwhelming, answers get shallow).

EXAMPLE BATCH:
"I have questions about your current integrations:
1. Which clearinghouse do you use today, and do you have a direct contract?
2. Who owns the connection to [PMS vendor] — your team or the vendor?
3. What data do you get back from the clearinghouse — just accept/reject, or line-level detail?
4. Are there any payers you connect to directly, bypassing the clearinghouse?"

NOT THIS:
"Question 1: Tell me about your integrations."
(too vague — they'll ramble for 10 minutes and you'll still have gaps)
\`\`\`

Every question must be specific enough to get a concrete answer. "Tell me about X" is not a question — it's abdication.

### Step 3: Probe vague answers, skip confirmed ones

When they answer:
- **Concrete answer** — record it, move to next question. Do NOT ask follow-ups on things that are clear.
- **Vague answer** ("we handle that", "it's pretty standard") — probe ONCE with a specific follow-up. If still vague, note as \`[NEEDS FOLLOW-UP]\` and move on. Do not loop.
- **"I don't know"** — record as \`[DEFERRED]\` with who might know. Move on immediately.
- **Answer reveals new gap** — note it for the NEXT batch. Do not derail the current batch.

\`\`\`
PACING RULE: The interview should feel FAST.
If you've been going for 15 minutes, you're doing it wrong.
Wrap up what you have and note remaining gaps.
\`\`\`

### Step 4: Update research docs with findings

After the interview, update the SOURCE research doc where each [USER] question originated:

1. Replace \`[USER]\` tag with the answer, tagged \`[CONFIRMED — stakeholder]\`
2. For deferred questions, change to \`[DEFERRED — {reason/who to ask}]\`
3. For answers that contradict research findings, update the research and tag \`[CORRECTED — stakeholder overrides research]\`
4. Add any new unknowns revealed by answers to the appropriate Open Questions section

\`\`\`
UPDATE THE RESEARCH DOC, NOT A SEPARATE INTERVIEW NOTES FILE.
The research doc is the source of truth. Interview findings flow INTO it.
\`\`\`

### Step 5: Close cleanly

When all [USER] questions are answered or deferred:

1. Summarize what was confirmed (2-3 bullet points, not a full recap)
2. List any [DEFERRED] items with who to ask
3. List any NEW gaps the interview revealed
4. State clearly: "Interview complete. Research docs updated."

Do NOT ask "is there anything else?" — that opens the door to a 30-minute tangent. If they have more to add, they'll say so.

## Red Flags — STOP

- About to ask a question that a web search could answer — RESEARCH IT YOURSELF
- About to ask about something the blurb already covered — REREAD THE BLURB
- About to ask one question per turn — BATCH 3-5 per turn
- About to dump all 15 questions at once — BATCH 3-5 per turn
- About to ask "tell me about your system" — that's a discovery session, not a gap-filler
- About to ask domain-knowledge questions ("how does X work in this industry?") — THAT IS RESEARCH, NOT INTERVIEW
- Interview has been going for 15+ minutes — WRAP UP
- About to create a separate interview-notes.md file — UPDATE THE RESEARCH DOCS DIRECTLY
- About to ask follow-up questions on a clear answer — MOVE ON
- No [USER] tags in any research doc and you're inventing questions — STOP. No interview needed.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Broader context helps me understand their system" | You have the research docs. Ask what's MISSING, not what's interesting. |
| "One question at a time is more thorough" | It's 3x slower and the user loses patience by question 8. Batch. |
| "I should ask about the domain basics to calibrate" | Research already calibrated. You're wasting their time on things you know. |
| "I'll ask open-ended questions to discover unknowns" | The research docs already surfaced the unknowns. Ask about THOSE. |
| "Interview notes should be a separate artifact" | Research docs are the source of truth. Update them directly. |
| "I should confirm what research found" | Only confirm [UNVERIFIED] items. Don't re-ask things tagged [VERIFIED]. |
| "The user might have context beyond the [USER] tags" | If they do, they'll volunteer it. Don't fish with vague questions. |
| "A thorough interview takes 45 minutes" | A thorough interview after good research takes 10-15. You did the research. |`;
}
