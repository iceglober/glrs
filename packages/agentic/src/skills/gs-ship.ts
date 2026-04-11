import { TASK_PREAMBLE } from "./preamble.js";

export function gsShip(): string {
  return `---
description: Ship the current task's branch — typecheck, review, commit, push, and create a PR. Use when user says 'ship it', 'create a PR', 'push and release', 'land this', 'send for review'. Runs full pre-flight pipeline before pushing. Never force-pushes or pushes to main.
---

# Ship

You are shipping the current task's branch. Pipeline: typecheck -> review -> commit -> push -> PR.

## Critical Rules

- **Never skip typecheck or review.**
- **Never force-push.**
- **Never push to main directly.**
- **Never commit \`.env\` or secrets.**
- Update task status to \`"shipped"\` only **after** creating the PR.

## Input

Optional PR context: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Step 1: Pre-flight

\`\`\`bash
git status
git log main..HEAD --oneline
git diff main...HEAD --stat
\`\`\`

- Uncommitted changes? Ask: commit or stash?
- HEAD equals main? Stop: "Nothing to ship."
- On \`main\`? Stop: "Create a branch first."

## Step 2: Independent verification

Do NOT trust prior sessions. Run fresh:

\`\`\`bash
bun run typecheck
bun test
bun run build
\`\`\`

Fix any failures. Do not ship broken code.

## Step 3: Review state check

If a task was found, check for unresolved review items:

\`\`\`bash
gs-agentic state review list --task <id> --status open --json
\`\`\`

If there are unresolved **CRITICAL** or **HIGH** items:
- List them with file references
- Warn: "There are N unresolved CRITICAL/HIGH review items. Shipping anyway may leave known issues unaddressed."
- Ask the user whether to proceed or address them first

If no task or no review items, continue normally.

## Step 4: Review the full diff

\`\`\`bash
git diff main...HEAD
\`\`\`

Read every line. Check for:
- **CRITICAL** — Bug, duplicate code blocks, security hole, data loss. Fix immediately.
- **ISSUE** — Real problem, not dangerous. Fix and explain.
- **SUGGESTION** — Could be better, isn't broken. Note for PR.

## Step 5: Task verification

- Read the current task from \`gs-agentic state\`
- Are there unchecked items that this diff completes? Mark them done via \`gs-agentic state task update\`.
- Do the acceptance criteria pass?

## Step 6: Version bump (if applicable)

Check if this repo uses versioning:

\`\`\`bash
# Check for package.json version field
cat package.json 2>/dev/null | grep '"version"' || true
\`\`\`

**If a version field exists**, analyze the diff from Step 4 and infer the appropriate semver bump:
- **Patch** (0.0.x) — bug fixes, refactors, doc updates, dependency bumps
- **Minor** (0.x.0) — new features, new commands, new skills, additive changes
- **Major** (x.0.0) — breaking changes to CLI interface, removed commands, changed public behavior

Apply the bump by updating the version in \`package.json\`. If there are other version files (e.g. \`version.ts\` with a hardcoded string), update those too — but only if they contain a literal version string, not if they read from \`package.json\` at build time.

**If no version field exists**, skip this step and Steps 7-8 entirely.

## Step 7: Release notes (if version bumped)

Generate a release notes file at \`releases/v{new_version}.md\`:

\`\`\`markdown
# v{new_version}

Released: {YYYY-MM-DD}

## Changes

- {imperative description of each logical change, grouped by type}

### New
- {new features, commands, skills}

### Changed
- {modifications to existing behavior}

### Fixed
- {bug fixes}
\`\`\`

Omit empty sections. Keep descriptions concise — one line per change. Base this on the full diff against main, not just the latest commit.

Create the \`releases/\` directory if it doesn't exist.

## Step 8: Update CLAUDE.md

Read the current \`CLAUDE.md\` and refresh it against the actual codebase:

1. **Architecture tree** — Scan \`src/\` recursively. Update the file tree to match reality:
   - Add files that exist but aren't listed
   - Remove files that are listed but no longer exist
   - Update one-line descriptions if they're inaccurate
   - Preserve the existing tree formatting style

2. **Commands section** — Verify the listed commands still work. Add any new ones.

3. **Key concepts** — Update if the implementation has changed the concepts described.

4. **Leave prose sections alone** unless they are factually wrong. Do not rewrite style or tone.

5. **Ensure a \`## Recent changes\` section exists** at the bottom, pointing to the release notes:
   \`\`\`
   ## Recent changes

   See \`releases/\` for version history and changelogs.
   \`\`\`

Commit the CLAUDE.md changes together with the version bump and release notes.

## Step 9: Commit

If there are uncommitted changes (including version bump, release notes, CLAUDE.md updates):
- Stage specific files — never \`git add -A\`
- Exclude: \`.env\`, \`.data/\`, credentials, large binaries
- Write a commit message:
  - First line: imperative, under 70 chars
  - End with \`Co-Authored-By: Claude <noreply@anthropic.com>\`

## Step 10: Push

\`\`\`bash
git push -u origin HEAD
\`\`\`

Never force-push.

## Step 11: Screenshots (if UI changes)

If the diff includes UI changes and the \`/browser\` skill is available, capture screenshots of the affected pages to include in the PR body. Save them to a temporary location and reference them in the PR.

## Step 12: Create PR

\`\`\`bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-4 bullets>

## Task
- **ID:** {task id}
- **Items completed:** {count}/{total}

## Review
- Typechecked: yes
- Auto-review: <CLEAN | N issues fixed>
- Review items: {N resolved} / {N total} (or "N/A")
- Version: {old_version} → {new_version} (or "N/A" if unversioned)

## Test plan
- [ ] <verification steps>

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
\`\`\`

## Step 13: Monitor PR checks

After PR creation, monitor CI checks until they all pass or one fails:

\`\`\`bash
gh pr checks <pr_number> --watch --fail-fast
\`\`\`

**If all checks pass:** Report success and continue to Step 14.

**If a check fails:**
1. Run \`gh pr checks <pr_number>\` to see which check failed
2. Run \`gh api repos/{owner}/{repo}/actions/runs/{run_id}/jobs\` or \`gh run view <run_id> --log-failed\` to get the failure logs
3. Read the failure output and diagnose the issue
4. Fix the code, commit, and push — the checks will re-run automatically
5. Return to the top of this step and watch again

Repeat until all checks are green. Do NOT leave a PR with failing checks.

## Step 14: Update task

- Transition the task to ship phase: \`gs-agentic state task transition --id <id> --phase ship --actor ship\`
- Set the task's PR field: \`gs-agentic state task update --id <id> --pr '<url>'\`
- Transition the task to done: \`gs-agentic state task transition --id <id> --phase done --actor ship\`

## Step 15: Report

\`\`\`
## Shipped

**Task:** {id}: {title}
**Branch:** {branch}
**PR:** {url}
**Checks:** all green
**Version:** {old} → {new} (or "unversioned")
**Review items:** {resolved}/{total} (or "N/A")
**Items completed:** {done}/{total}
\`\`\`
`;
}
