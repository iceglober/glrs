---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/cli": minor
---

feat: add .glrs/hooks/ and .glrs/extensions/ system

**Hooks** (shell scripts, run by the CLI):
- `.glrs/hooks/wt-new` — runs after `glrs wt new` creates a worktree. Receives the worktree path as $1 and WORKTREE_DIR + REPO_NAME as env vars. Use for: installing deps, setting up .env, running migrations, starting dev services.

**Extensions** (agent prompt fragments, loaded by the harness):
- `.glrs/extensions/post-ship.md` — appended to the `/ship` command's prompt. Use for: custom post-PR-creation behavior like "wait for auto-review, address feedback, monitor checks, get PR mergeable."

Hooks are executable files that run synchronously with a 2-minute timeout. Extensions are markdown files whose content is injected into the agent's prompt at command dispatch time. Both are repo-level (committed, shared across worktrees).
