---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot: add `.glrs/hooks/pilot_setup` — repo-level setup hook

A user-authored shell script at `.glrs/hooks/pilot_setup` (relative to the repo root) is auto-invoked once at the start of `pilot build` and `pilot build-resume`, before any task runs. Its job is to make the dev stack ready: install deps, start docker services, run migrations, seed data — whatever the plan's verify commands expect to already be running.

Contract:
- **Missing file → skip silently.** No hook = no setup = the old behavior.
- **Present + executable → run it.** stdout/stderr stream live to the terminal so the user sees install progress.
- **Non-zero exit → abort the pilot run.** User fixes their env first.
- **10-minute timeout → abort.** Prevents hung installs from blocking indefinitely.
- **Not executable → abort with a clear message** (`chmod +x .glrs/hooks/pilot_setup`).

Why this instead of the old plan-level `setup:` field:
- It's version-controlled in the user's repo, not LLM-authored.
- One hook per repo covers every plan — no cross-plan drift.
- The user controls exactly what runs (no pilot-opinionated defaults).
- It's idempotent by convention — safe to re-run on resume.

Example `.glrs/hooks/pilot_setup`:
```bash
#!/bin/sh
set -e
pnpm install --frozen-lockfile
docker compose up -d postgres redis
pnpm prisma migrate dev --skip-generate
```
