import { REVIEW_PREAMBLE } from "./preamble.js";

export function gsAddressFeedback(): string {
  return `---
description: Address PR review feedback — gather all unresolved comments and review items, classify each (fix/pushback/acknowledge/wont-fix), implement fixes, respond on GitHub with evidence. Use when user says 'address feedback', 'handle PR comments', 'resolve review items', 'respond to reviewer'. Reads from both GitHub PR comments and gs-agentic review state.
---

# Address Feedback — PR Review Resolution

You are resolving all outstanding review feedback for the current PR. Every response MUST cite specific code as evidence.

## Critical Rules

- **Every classification MUST cite specific code.** "I disagree" is not pushback. "See db.ts:42 where we already handle this case via..." is pushback.
- **Read the referenced code before classifying.** Don't classify from the comment text alone.
- **Group related fixes into logical commits.** Don't create one commit per comment.
- **Never dismiss a comment without evidence.** If you push back, explain WHY with code references.

## Input

Optional context: \`$ARGUMENTS\`

${REVIEW_PREAMBLE}

## Step 1: Confirm PR

\`\`\`bash
gh pr view --json number,url,title,state,headRefName
\`\`\`

If no PR exists, stop: "No PR found. Run \`/gs-ship\` first."
If PR is closed/merged, stop: "PR is already {state}."

Store the PR number, URL, and head branch.

## Step 2: Gather ALL unresolved feedback

Collect feedback from three sources:

### Source A: PR comments from GitHub

\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments --paginate
\`\`\`

Extract each comment's: id, body, path, line, created_at, user.login.

### Source B: PR reviews from GitHub

\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/reviews --paginate
\`\`\`

For reviews with state "CHANGES_REQUESTED" or body content, extract the review body and any inline comments.

### Source C: Stored review items from gs-agentic state

\`\`\`bash
gs-agentic state review list --task <task-id> --status open --json
\`\`\`

### Deduplication

PR comments may already be stored from a prior \`/gs-deep-review\` or \`/gs-quick-review\`. Before storing new items, check if an existing review item covers the same file+line+issue. If so, merge (add \`pr_reviewer\` to agents, keep the higher severity) rather than creating a duplicate.

## Step 3: Store new items

For PR comments not already in the DB:

\`\`\`bash
# Create a review record for this feedback pass
REVIEW_ID=$(gs-agentic state review create --task <task-id> --source pr_comment \\
  --commit-sha $(git rev-parse HEAD) --pr-number <num> --summary "PR feedback")

# For each new comment:
gs-agentic state review add-item --review $REVIEW_ID \\
  --body "<comment body>" \\
  --file "<path>" --line <line> \\
  --severity <inferred severity> \\
  --agents "pr_reviewer" \\
  --pr-comment-id <github-comment-id>
\`\`\`

## Step 4: Classify each open item

For each open review item:
1. Read the file at the referenced line range — not just the line, but enough surrounding context to understand the flow
2. If the comment references behavior (e.g. "this will break when X"), trace the code path to verify or refute the claim
3. Only after reading the code, classify:

- **MUST_FIX** — The comment is correct. Cite the specific code that confirms the problem (e.g. "Confirmed: \`db.ts:42\` queries without the tenant filter, so cross-tenant data leaks are possible").
- **PUSHBACK** — The comment is wrong or already handled. Cite the specific code that refutes it (e.g. "Already handled: \`auth.ts:87-92\` validates the token expiry before reaching this code path").
- **ACKNOWLEDGE** — Valid concern, out of scope for this PR. Cite the code that shows the concern exists AND explain concretely what follow-up is planned (e.g. "Confirmed \`cache.ts:15\` has no TTL. Out of scope — tracked as task t12 / will address in next PR").
- **WONT_FIX** — Intentional design choice. Cite the architectural reason from the codebase (e.g. "By design: \`config.ts:8\` sets this limit because the upstream API enforces it — see their docs at ...").

**Evidence rules (non-negotiable):**
- Every classification MUST cite at least one specific \`file:line\` reference that you actually read
- "I checked and it's fine" is NOT evidence. Quote or describe the specific code.
- PUSHBACK: you must show WHERE the concern is already handled — name the function, the guard, the check
- ACKNOWLEDGE: you must show the code that exhibits the concern (proving you verified it's real) AND state a concrete follow-up (issue ID, task ID, or "next PR")
- WONT_FIX: you must cite the architectural constraint or requirement that justifies the choice — not just "it's intentional"
- If you cannot find evidence for your classification, CHANGE your classification. "I couldn't find where this is handled" means it's MUST_FIX, not PUSHBACK.

### Evidence self-check

Before proceeding to Step 5, review your classifications as a batch. For each item, verify:
1. Does your classification cite a specific \`file:line\` you actually read?
2. For PUSHBACK: can you name the exact function, guard, or check that handles the concern? If not → reclassify as MUST_FIX.
3. For ACKNOWLEDGE: did you confirm the concern exists in the code AND state a concrete follow-up (issue ID, task ID, or "next PR")? If not → add the missing piece.
4. For WONT_FIX: did you cite an architectural constraint from the codebase, not just a preference? If not → reclassify as ACKNOWLEDGE or MUST_FIX.

If any item fails this check, fix it now before moving on.

## Step 5: Plan and execute fixes

For MUST_FIX items:
1. Group related fixes that can be addressed together
2. For each group:
   - Read the relevant files
   - Implement the fix (TDD if applicable)
   - Run typecheck + tests
3. Commit with a descriptive message
4. After each commit, record the resolution:
   \`\`\`bash
   gs-agentic state review resolve --item <item-id> --status fixed \\
     --resolution "Changed <file:line>: <what was wrong> → <what it does now>." \\
     --commit-sha $(git rev-parse HEAD)
   \`\`\`

For PUSHBACK items:
\`\`\`bash
gs-agentic state review resolve --item <item-id> --status pushed_back \\
  --resolution "Already handled: <file:line> does <what>. <quote or describe the specific guard/check/logic>."
\`\`\`

For ACKNOWLEDGE items:
\`\`\`bash
gs-agentic state review resolve --item <item-id> --status acknowledged \\
  --resolution "Confirmed: <file:line> shows <the concern>. Out of scope — <concrete follow-up: issue ID, task ID, or 'next PR'>."
\`\`\`

For WONT_FIX items:
\`\`\`bash
gs-agentic state review resolve --item <item-id> --status wont_fix \\
  --resolution "By design: <file:line> — <architectural constraint or requirement>. <why this is the right tradeoff>."
\`\`\`

## Step 6: Respond on GitHub

For each resolved item that came from a PR comment (has \`pr_comment_id\`), reply on the PR:

**Before posting any reply:** re-read what you're about to send. Does it contain a specific \`file:line\` reference? Does it describe what the code does at that location? If not, go back and find the evidence.

**Fixed items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="Fixed in $(git rev-parse --short HEAD). Changed \\\`file.ts:42\\\`: <what was wrong> → <what it does now>."
\`\`\`

**Pushback items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="Already handled — \\\`file.ts:42\\\` <does what>: <quote or describe the guard/check>. This covers the case you raised because <reasoning>."
\`\`\`

**Acknowledge items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="Confirmed — \\\`file.ts:42\\\` <shows the concern>. Out of scope for this PR because <reason>. Tracking as <issue/task ID or 'will address in next PR'>."
\`\`\`

**Wont-fix items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="By design — \\\`file.ts:42\\\` <architectural constraint>. <why this is the right tradeoff>."
\`\`\`

## Step 7: Push and summarize

\`\`\`bash
git push
\`\`\`

Then show the summary:

\`\`\`bash
gs-agentic state review summary --task <task-id>
\`\`\`

Report:

\`\`\`
## Feedback Addressed

**PR:** {url}
**Task:** {task id}: {title}

| Status | Count |
|--------|-------|
| Fixed | {n} |
| Pushed back | {n} |
| Acknowledged | {n} |
| Won't fix | {n} |
| Remaining open | {n} |

{If remaining open items, list them with severity}
\`\`\`

If all items are resolved, end with: "All feedback addressed. PR is ready for re-review."
`;
}
