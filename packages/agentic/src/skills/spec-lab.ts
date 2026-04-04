export function specLab(): string {
  return `---
description: Design and run validation experiments against spec unknowns. Binary yes/no hypothesis testing — does X work? Can we do Y? Use when user says 'validate this unknown', 'test if this works', 'run experiments', 'can we prove this', 'lab test'. Do NOT use for open-ended optimization (use /research-auto instead). Provide a spec path or specific unknown to validate.
---

# /spec-lab — Validation Experiments

Design and orchestrate **validation experiments** — binary yes/no questions that resolve spec unknowns through code. For open-ended optimization or iteration, use \\\`/research-auto\\\` instead.

Pipeline: \\\`/research-web\\\` -> \\\`/spec-make\\\` -> \\\`/spec-lab\\\` -> \\\`/spec-enrich\\\` -> \\\`/spec-refine\\\`

---

## Input

Parse \\\`$ARGUMENTS\\\` for one of:

1. **A spec file path** — auto-mode: triage all unknowns, run experiments for the experimentable ones
2. **A specific unknown** (e.g., \\\`U-03\\\`) + spec path — run a single validation experiment
3. **No arguments** — find the latest spec in the project, triage, and run

---

## Phase 1: Triage Unknowns

Read the spec. For each unknown, classify:

### Experimentable (validation)
Binary questions answerable by writing and running code:
- "Does the API support batch requests?" → write a test, run it
- "Can we query across tenants with the current ORM?" → try it
- "Does the webhook fire on status change?" → trigger it and check
- "Will the parser handle nested PDFs?" → feed it one

### NOT experimentable
- Business decisions (pricing, prioritization)
- External vendor capabilities (need to contact them)
- Legal/compliance questions
- Domain expertise (payer rules, billing practices)
- Architecture decisions that need team consensus

### Present the triage:

\\\`\\\`\\\`
## Experiment Plan

**Spec:** [file path]
**Total unknowns:** N

### Will validate (binary experiments):
1. [U-xx]: [title] — hypothesis: [yes/no question]
2. [U-xx]: [title] — hypothesis: [yes/no question]

### Not experimentable (skipping):
- [U-xx]: [title] — reason: [why]

### For iteration (use /research-auto instead):
- [U-xx]: [title] — reason: [why this needs open-ended exploration]

Proceeding with validation experiments.
\\\`\\\`\\\`

Do NOT wait for approval — proceed immediately. This skill is autonomous.

---

## Phase 2: Design Experiments

For each experimentable unknown, write a **self-contained instruction file** at \\\`.lab/validations/[U-xx].md\\\`:

\\\`\\\`\\\`markdown
# Validation: [U-xx] — [title]

## Hypothesis
[Clear yes/no statement, e.g., "The encounters API supports batch GET requests with up to 100 IDs"]

## Success criteria
- PASS: [what constitutes a yes]
- FAIL: [what constitutes a no]
- PARTIAL: [what constitutes a qualified yes, if applicable]

## Test approach
1. [Step-by-step plan — what to build, what to run, what to check]
2. [Be specific about files, endpoints, commands]
3. [Include cleanup steps]

## Scope
- Files to create: [list]
- Files to read (not modify): [list]
- Commands to run: [list]

## Max turns: 50
\\\`\\\`\\\`

Design principles:
- Each experiment is **self-contained** — another agent can execute it with no additional context
- Tests should be **non-destructive** — read-only queries, scratch files, test endpoints
- Include **cleanup** — remove test files, revert changes
- Be **specific** — exact API calls, exact file paths, exact assertions

---

## Phase 3: Run Experiments

Create \\\`.lab/\\\` directory if it doesn't exist. Add \\\`.lab/\\\` to \\\`.gitignore\\\` if not already there.

Launch validation experiments in **parallel** using the Agent tool with \\\`run_in_background: true\\\`:

For each validation:
1. Spawn a subagent with the instruction file content as its prompt using Sonnet
2. The subagent must:
   - Execute the test plan
   - Record raw results
   - Return a verdict: PASS, FAIL, or PARTIAL with evidence
3. Use \\\`run_in_background: true\\\` — validations are independent

### Monitoring

Check progress every ~2 minutes:
- Which agents have completed?
- Any crashes or hangs? Kill and log as INCONCLUSIVE after 5 minutes.

---

## Phase 4: Collect Results

As each agent completes, record the result in \\\`.lab/validation-results.md\\\`:

\\\`\\\`\\\`markdown
## Validation Results

| Unknown | Hypothesis | Verdict | Evidence | Duration |
|---------|-----------|---------|----------|----------|
| U-xx | [hypothesis] | PASS/FAIL/PARTIAL/INCONCLUSIVE | [one-line summary] | Xs |
\\\`\\\`\\\`

For each result, also write a detailed entry:

\\\`\\\`\\\`markdown
### U-xx: [title]
**Verdict:** PASS/FAIL/PARTIAL/INCONCLUSIVE
**Evidence:** [what was observed — specific output, error messages, behavior]
**File references:** [file:line for any relevant code discovered]
**Implications:** [what this means for the spec — which requirements are affected]
\\\`\\\`\\\`

---

## Phase 5: Update Spec

Generate an updated spec version applying validation results:

1. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. Never overwrite.

2. **For PASS results:**
   - Resolve the unknown — remove from register
   - Embed the validated fact in requirements with evidence
   - Remove \\\`[depends: U-xx]\\\` tags from unblocked requirements

3. **For FAIL results:**
   - Update the unknown with what was disproven
   - Flag affected requirements — they may need redesign
   - Add new unknowns if the failure reveals alternative approaches

4. **For PARTIAL results:**
   - Narrow the unknown — record what's confirmed and what remains
   - Keep \\\`[depends: U-xx]\\\` tags

5. **For INCONCLUSIVE:**
   - Keep the unknown as-is
   - Note the attempted approach so it's not retried

6. **Add a changelog entry:**

\\\`\\\`\\\`markdown
### v[N] — lab validation (YYYY-MM-DD)
- Validated: U-xx (PASS), U-xx (FAIL), ...
- Resolved: N unknowns
- New unknowns from failures: N
- Remaining unknowns: N
\\\`\\\`\\\`

---

## Phase 6: Report

\\\`\\\`\\\`
## Lab Complete

**Spec:** [file name]
**Experiments run:** N
**PASS:** N  |  **FAIL:** N  |  **PARTIAL:** N  |  **INCONCLUSIVE:** N

### Key findings:
- [most impactful validations with evidence]

### Failures that change the plan:
- [U-xx]: [what failed and what it means]

### Remaining unknowns:
- N experimentable (could re-run with different approach)
- N not experimentable (needs human input)
- N iterative (use /research-auto)

Updated spec: [file path]

**Next step:**
- If failures changed requirements -> run \\\`/spec-review [new file]\\\`
- If unknowns remain -> run \\\`/spec-refine [new file]\\\`
- For iterative unknowns -> run \\\`/research-auto\\\`
\\\`\\\`\\\`

---

## Rules

1. **Validation only.** Binary yes/no questions. If you can't phrase it as a hypothesis with clear pass/fail criteria, it's not a validation — suggest \\\`/research-auto\\\` instead.
2. **Non-destructive.** Tests should not modify production data, break existing functionality, or leave artifacts. Clean up after.
3. **Evidence-based.** Every verdict needs specific evidence — output, error messages, file references. "It seems to work" is not a verdict.
4. **Parallel when possible.** Independent validations run simultaneously.
5. **Self-contained instructions.** Each experiment file must be executable by an agent with no additional context.
6. **Version, don't overwrite.** Always write a new spec file.
7. **Proceed autonomously.** Present the plan and immediately start running. Don't wait for approval.
8. **Fail fast.** If a validation is clearly going to fail (wrong API, missing feature), log it and move on. Don't burn turns trying to make it work.
`;
}
