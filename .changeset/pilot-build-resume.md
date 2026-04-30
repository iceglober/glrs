---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot: add `pilot build-resume` — continue a partially-completed run

When `pilot build` fails mid-run (task failure, stall, abort), previously the only recovery was to rerun from scratch or finish manually. `pilot build-resume` picks up where the run left off:

- Discovers the latest non-terminal run in the repo (or honors `--run <id>`).
- Skips `succeeded` tasks — their commits are already on HEAD.
- Resets every non-succeeded task (failed/blocked/aborted/running) to `pending` with `attempts=0` and a fresh retry budget. Cost is preserved.
- Re-marks the run as `running`, clears `finished_at`.
- Pre-flight: same safety gate as `pilot build` (clean tree, feature branch) PLUS a branch-match check — refuses if the current branch name doesn't equal the branch recorded on any succeeded task from the run. Prevents "I switched branches since" mistakes.
- Loads the plan from the path recorded on the run row. If the user edited the plan between runs, the resume picks up the edited version.

Usage:

```bash
# resume the latest failed/blocked run in this repo
pilot build-resume

# or target a specific run
pilot build-resume --run 01KQDEDKGMAF6NGSKNS2H8QB4V
```

Exit codes:
- `0` — resume succeeded (every remaining task completed).
- `1` — wiring failure, branch mismatch, or safety gate refusal.
- `2` — no resumable tasks (all succeeded, or no runs found).
- `3` — resume ran but at least one task failed.
- `130` — SIGINT.

New state accessors: `resetTasksForResume()`, `markRunResumed()`.
