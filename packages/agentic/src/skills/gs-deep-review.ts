import { REVIEW_PREAMBLE } from "./preamble.js";

export function gsDeepReview(): string {
  return `---
description: Conduct a thorough multi-agent parallel code review of the current branch's changes. Six specialized agents (Security, Data Integrity, Frontend/UX, API Contracts, Test Coverage, Logical Integrity) analyze changes simultaneously and produce a consolidated severity-grouped report. Stores findings in gs-agentic review state. Use when you want a comprehensive review before shipping.
---

# Deep Review

Conduct an extremely thorough code review of the current branch's changes using 6 specialized review agents running in parallel.

**Optional arguments:** $ARGUMENTS

${REVIEW_PREAMBLE}

If a task is found, store its context (title, description, spec summary, acceptance criteria) as \`TASK_CONTEXT\` — this will be included in each agent's prompt so they can review against the task's intent, not just code correctness.

## Phase 1: Gather Context and Determine Diff Strategy

First, determine what to review. Run these commands to understand the current state:

\`\`\`bash
git diff --cached --stat
git diff --stat
git branch --show-current
git merge-base main HEAD
\`\`\`

**Diff strategy (in order of precedence):**

1. If the user passed \`--staged-only\`, use only staged changes: \`git diff --cached\`
2. If the user passed \`--base <branch>\`, use that as the base: \`git diff <branch>...HEAD\`
3. If there are staged changes, review staged changes: \`git diff --cached\`
4. If there are unstaged changes, review all working tree changes: \`git diff\`
5. If the working tree is clean, compare HEAD against the merge-base with main: \`git diff $(git merge-base main HEAD)...HEAD\`

Store the chosen diff command as \`DIFF_CMD\` for the agents to use. Also store the \`--stat\` output so agents know which files were touched.

Run the full diff and the stat diff so you have the complete picture before launching agents.

## Phase 2: Launch 6 Specialized Review Agents IN PARALLEL

Launch ALL 6 agents simultaneously using the Agent tool. Each agent receives the diff command, the list of changed files, AND the task context (if available). Each agent MUST use the diff command to read changes and MUST read full files for context (not just diffs).

**IMPORTANT:** Launch all 6 agents in a SINGLE message to maximize parallelism. Do NOT wait for one to finish before starting the next.

Each agent prompt should include this task context block (if a task was found):

\`\`\`
TASK CONTEXT:
- Title: {task title}
- Description: {task description}
- Acceptance criteria: {from spec if available}

Review the changes against this task context — flag anything that contradicts the task's intent or misses acceptance criteria.
\`\`\`

---

### Agent 1: Security & Authorization

\`\`\`
You are a security-focused code reviewer for a TypeScript monorepo.

DIFF COMMAND: {DIFF_CMD}
CHANGED FILES: {file list from --stat}
{TASK_CONTEXT block if available}

Run the diff command to see all changes. For each changed file, read the FULL file for context.

Review for these specific concerns:

1. **Authentication & Authorization bypass** — Are auth checks present on new routes? Do new endpoints use proper middleware?
2. **Row-Level Security (RLS)** — Are new queries using the appropriate DB access pattern?
3. **Injection vulnerabilities** — SQL injection via raw queries, XSS via unsanitized output, command injection.
4. **Data exposure** — Are sensitive fields filtered from API responses? Are error messages leaking internal details?
5. **Permission escalation** — Can a user access another org's data? Are boundaries enforced?
6. **Secret handling** — Hardcoded secrets, credentials in code, .env values committed, tokens in logs.

For each finding, report:
- **Severity**: CRITICAL, HIGH, MEDIUM, LOW, or NITPICK
- **File**: Full path with line number
- **Finding**: What the issue is
- **Why it matters**: Impact if exploited
- **Suggested fix**: How to resolve it

If you find NO issues in a category, say so explicitly. Do not fabricate findings.
\`\`\`

---

### Agent 2: Data Integrity & Correctness

\`\`\`
You are a data integrity reviewer for a TypeScript monorepo.

DIFF COMMAND: {DIFF_CMD}
CHANGED FILES: {file list from --stat}
{TASK_CONTEXT block if available}

Run the diff command to see all changes. For each changed file, read the FULL file for context.

Review for these specific concerns:

1. **Migration safety** — Do new migrations have down migrations? Are they additive or destructive?
2. **Query correctness** — Are queries correct? Check join conditions, where clauses, null handling.
3. **Schema mismatches** — Do schemas match the database columns?
4. **Data transformations** — Are type conversions safe? Dates handled correctly? Enums consistent?
5. **Race conditions** — TOCTOU issues? Should operations use transactions?
6. **Null safety** — Are nullable fields handled in application code?
7. **Edge cases** — Empty arrays, zero counts, missing relations, boundary values.

For each finding, report:
- **Severity**: CRITICAL, HIGH, MEDIUM, LOW, or NITPICK
- **File**: Full path with line number
- **Finding**: What the issue is
- **Impact**: What could go wrong
- **Suggested fix**: How to resolve it

If you find NO issues in a category, say so explicitly. Do not fabricate findings.
\`\`\`

---

### Agent 3: Frontend & UX

\`\`\`
You are a frontend reviewer for a TypeScript application.

DIFF COMMAND: {DIFF_CMD}
CHANGED FILES: {file list from --stat}
{TASK_CONTEXT block if available}

Run the diff command to see all changes. For each changed file, read the FULL file for context.

Review for: React patterns, state management, loading & error states, accessibility, component patterns, type safety, performance.

For each finding, report: Severity, File, Finding, User impact, Suggested fix.

If the diff contains NO frontend changes, state that clearly and skip the review. Do not fabricate findings.
\`\`\`

---

### Agent 4: API Contract & Consistency

\`\`\`
You are an API contract reviewer for a TypeScript monorepo.

DIFF COMMAND: {DIFF_CMD}
CHANGED FILES: {file list from --stat}
{TASK_CONTEXT block if available}

Run the diff command to see all changes. For each changed file, read the FULL file for context.

Review for: Contract-to-router alignment, schema consistency, route registration, breaking changes, naming conventions, error handling, pagination & filtering.

For each finding, report: Severity, File, Finding, Impact, Suggested fix.

If the diff contains NO API/contract changes, state that clearly and skip the review. Do not fabricate findings.
\`\`\`

---

### Agent 5: Test Coverage & Quality

\`\`\`
You are a test coverage and quality reviewer for a TypeScript monorepo.

DIFF COMMAND: {DIFF_CMD}
CHANGED FILES: {file list from --stat}
{TASK_CONTEXT block if available}

Run the diff command to see all changes. For each changed file, read the FULL file for context.

Review for: Missing test coverage, modified test correctness, test completeness, impossible test states, test isolation, assertion quality, test patterns.

For each finding, report: Severity, File, Finding, Risk, Suggested fix.

If the diff contains NO testable logic changes, state that clearly. Do not fabricate findings.
\`\`\`

---

### Agent 6: Logical Integrity

\`\`\`
You are a logical integrity reviewer. Your job is to find logical errors, gaps, and inconsistencies that the other specialized reviewers are likely to miss because they focus on their own domain.

DIFF COMMAND: {DIFF_CMD}
CHANGED FILES: {file list from --stat}
{TASK_CONTEXT block if available}

Run the diff command to see all changes. For each changed file, read the FULL file for context. Also read closely related files.

Review for: Business logic correctness, cross-file consistency, state machine coherence, assumption violations, boundary conditions, control flow gaps, semantic mismatches, feature completeness, task alignment.

For each finding, report: Severity, File, Finding, Why it's wrong, Suggested fix.

If you find NO issues in a category, say so explicitly. Do not fabricate findings.
\`\`\`

## Phase 3: Consolidate and Store Results

After ALL 6 agents complete, consolidate their findings.

### Step 1: Collect and deduplicate

Gather every finding from all 6 agents. Merge duplicates (same file+line+issue), keeping the highest severity and crediting all agents that found it.

### Step 2: Store findings in DB

If a task was found, persist the review:

\`\`\`bash
# Create the review record
REVIEW_ID=$(gs-agentic state review create --task <task-id> --source deep_review \\
  --commit-sha $(git rev-parse HEAD) --summary "6-agent deep review")

# For each deduplicated finding:
gs-agentic state review add-item --review $REVIEW_ID \\
  --body "<finding description>" \\
  --file "<path>" --line <line> \\
  --severity <CRITICAL|HIGH|MEDIUM|LOW|NITPICK> \\
  --agents "<comma-separated agent names>" \\
  --impact "<why it matters>" \\
  --suggested-fix "<how to resolve>"
\`\`\`

Agent names: \`security\`, \`data_integrity\`, \`frontend_ux\`, \`api_contracts\`, \`test_coverage\`, \`logical_integrity\`.

### Step 3: Produce the report

\`\`\`
## Deep Review Results

**Branch:** {branch name}
**Base:** {base reference}
**Task:** {task id}: {task title} (or "No task" if ad-hoc)
**Files reviewed:** {count}
**Summary:** {X critical, Y high, Z medium, W low, V nitpick}

### Findings

| # | Severity | Finding | File | Agent |
|---|----------|---------|------|-------|
| 1 | CRITICAL | Description | path:line | Security |
| 2 | HIGH     | Description | path:line | Data Integrity |
| ... | ... | ... | ... | ... |

### Actionable Items (CRITICAL + HIGH)

These MUST be addressed before merging:

1. **[CRITICAL]** Finding description
   - File: \`path/to/file.ts:123\`
   - Fix: Suggested resolution
   - Found by: Agent name

### Recommendations (MEDIUM)

These SHOULD be addressed:

1. ...

### Informational (LOW + NITPICK)

Nice-to-have improvements:

1. ...

### Agent Notes

Brief summary from each agent:
- **Security:** {1-2 sentence summary}
- **Data Integrity:** {1-2 sentence summary}
- **Frontend/UX:** {1-2 sentence summary}
- **API Contracts:** {1-2 sentence summary}
- **Test Coverage:** {1-2 sentence summary}
- **Logical Integrity:** {1-2 sentence summary}
\`\`\`

### Step 4: Final verdict and next steps

End with one of:
- **SHIP IT** -- No critical or high findings. Code is ready to merge.
- **NEEDS FIXES** -- Has high/critical findings that must be addressed.
- **STOP** -- Has critical issues that indicate fundamental problems with the approach.

Then use the AskUserQuestion tool based on the verdict:

**If SHIP IT:**
\`\`\`
question: "Review clean — no critical or high findings. What's next?"
header: "Next step"
options:
  1. label: "QA (Recommended)", description: "Run QA against the task's acceptance criteria"
  2. label: "Ship it", description: "Typecheck, commit, push, and create a PR"
  3. label: "Done for now", description: "Stop here — come back later"
\`\`\`

Based on the user's response:
- **QA**: invoke the qa skill using the Skill tool: Skill("qa")
- **Ship it**: invoke the ship skill using the Skill tool: Skill("ship")
- **Done for now**: stop
- **Other (free text)**: the user is giving direction — follow their instructions

**If NEEDS FIXES or STOP:**
\`\`\`
question: "Review found issues that need addressing. What's next?"
header: "Next step"
options:
  1. label: "Plan the fixes (Recommended)", description: "Create a structured fix plan with /deep-plan"
  2. label: "QA anyway", description: "Run QA to see full acceptance criteria status"
  3. label: "Ship anyway", description: "Skip unresolved CRITICAL/HIGH findings — typecheck, commit, push, and create a PR"
  4. label: "Done for now", description: "Stop here — address findings later"
\`\`\`

Based on the user's response:
- **Plan the fixes**: invoke the deep-plan skill using the Skill tool with a one-line summary of each CRITICAL and HIGH finding (severity, file:line, description) as the argument: Skill("deep-plan", args: "<findings summary>")
- **QA anyway**: invoke the qa skill using the Skill tool: Skill("qa")
- **Ship anyway**: invoke the ship skill using the Skill tool: Skill("ship")
- **Done for now**: stop
- **Other (free text)**: the user is giving direction — follow their instructions

Do NOT auto-fix. Wait for the user's choice.
`;
}
