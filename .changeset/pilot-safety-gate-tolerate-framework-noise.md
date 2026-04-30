---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot: safety gate tolerates framework-owned dirty files (`.opencode/**`, `next-env.d.ts`, etc.)

When opencode auto-updates its plugin dep in the background, it bumps `.opencode/package.json` + `.opencode/package-lock.json`. Previously the pilot safety gate rejected those dirty files as "user uncommitted work," blocking `pilot build` on something the user didn't do and couldn't preempt.

**Fix:** A new `SAFETY_GATE_TOLERATE` list mirrors the post-task `DEFAULT_TOLERATE` pattern. Dirt ONLY in these paths is allowed; pilot proceeds with a one-line warning showing which framework-owned files were modified. Genuine user dirt (anywhere else) still refuses as before. Mixed dirty trees (framework + user) refuse and surface the user-owned path in the error message.

Tolerated paths:
- `.opencode/**` — opencode plugin installer churn.
- `**/next-env.d.ts`, `**/.next/types/**`, `**/.next/dev/types/**` — Next.js artifacts.
- `**/*.tsbuildinfo` — TypeScript incremental build cache.
- `**/__snapshots__/**`, `**/*.snap` — test snapshot files.

User-visible:
- `pilot build` prints `[pilot] working tree has N modified file(s) in framework-owned paths; treating tree as clean:` followed by the first 5 paths before starting.
- `pilot build-resume` does the same.

Also fixed a porcelain-parser bug that ate the leading space off `git status --porcelain` lines; new tests cover the round-trip.
