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

For each open review item, read the referenced code at the file and line range. Understand the context. Then classify:

- **MUST_FIX** — The comment is correct, code needs to change.
- **PUSHBACK** — The comment is wrong or misunderstands the code. Cite evidence from the codebase.
- **ACKNOWLEDGE** — Valid point but out of scope. Explain why and what follow-up is planned.
- **WONT_FIX** — Intentional design choice. Explain the rationale with code references.

**Classification rules:**
- Every classification MUST cite specific file:line references
- PUSHBACK requires evidence that the concern is already handled or inapplicable
- ACKNOWLEDGE requires a concrete follow-up action (issue, task, or "will address in next PR")
- WONT_FIX requires rationale grounded in architecture or requirements, not preference

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
     --resolution "<what was done and why>" \\
     --commit-sha $(git rev-parse HEAD)
   \`\`\`

For PUSHBACK items:
\`\`\`bash
gs-agentic state review resolve --item <item-id> --status pushed_back \\
  --resolution "<evidence from code explaining why this is already handled or not applicable>"
\`\`\`

For ACKNOWLEDGE items:
\`\`\`bash
gs-agentic state review resolve --item <item-id> --status acknowledged \\
  --resolution "<why it's out of scope and what the follow-up plan is>"
\`\`\`

For WONT_FIX items:
\`\`\`bash
gs-agentic state review resolve --item <item-id> --status wont_fix \\
  --resolution "<design rationale with code references>"
\`\`\`

## Step 6: Respond on GitHub

For each resolved item that came from a PR comment (has \`pr_comment_id\`), reply on the PR:

**Fixed items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="Fixed in $(git rev-parse --short HEAD). <brief description of what changed>."
\`\`\`

**Pushback items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="This is intentional — <evidence from code>. See \\\`file.ts:42\\\` where we handle this case via..."
\`\`\`

**Acknowledge items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="Good catch. This is out of scope for this PR — <reason>. Tracking as follow-up in <issue/task>."
\`\`\`

**Wont-fix items:**
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{num}/comments/{comment-id}/replies \\
  -f body="By design — <rationale with code reference>. <brief explanation of the architecture decision>."
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
