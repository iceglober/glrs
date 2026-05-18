# Wave 3 — Deterministic Settings

**Focus:** Wire the ~20 deterministic config fields into the existing autopilot code paths. Each field replaces a hardcoded constant or boolean.

---

## Items

- [ ] 3.1 **Verify strategy.** Replace the hardcoded post-phase verify behavior with `config.verify` (`after_phase` | `after_item` | `skip`). When `skip`, bypass `runVerifyCommands` entirely. When `after_item`, run verify after each per-item loop iteration (fast mode only — falls back to `after_phase` for deep mode). `config.verify_timeout` replaces the hardcoded 5-minute timeout in `verify-runner.ts`. `config.verify_retry` controls whether a failed verify triggers a phase retry.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — branch on `config.verify`
    - `packages/harness-opencode/src/autopilot/verify-runner.ts` — accept timeout from config
  - verify: `bun run build && bun test`

- [ ] 3.2 **Iteration budgets from config.** Replace `MAX_ITERATIONS_PER_PHASE_BY_TIER` and `MAX_ITERATIONS_PER_ITEM` with `config.max_iterations_per_phase` and `config.max_iterations_per_item`. The tier-based defaults become the fallback when config doesn't specify. `config.stall_timeout` replaces `STALL_MS_BY_TIER`.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — read from config
    - `packages/harness-opencode/src/autopilot/loop.ts` — read stall timeout from config
    - `packages/harness-opencode/src/autopilot/config.ts` — keep constants as fallbacks
  - verify: `bun run build && bun test`

- [ ] 3.3 **Hooks.** Run shell commands at lifecycle points: `pre_phase`, `post_phase`, `post_run`, `on_error`. Each hook runs via `execFile("/bin/sh", ["-c", cmd])` in the repo root with `verify_timeout` as the timeout. Non-zero exit = hook failure. `pre_phase` failure skips the phase. `post_phase` failure logs a warning but doesn't fail the phase. `on_error` is fire-and-forget.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/hook-runner.ts` — `runHook(cmd, cwd, timeout): Promise<{ ok: boolean; output: string }>`
    - `packages/harness-opencode/test/hook-runner.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — call hooks at lifecycle points
  - verify: `bun test test/hook-runner.test.ts`

- [ ] 3.4 **Changeset settings.** `config.changeset` (bool) controls whether `generateChangeset` runs. `config.changeset_bump` overrides the auto-detection. `config.changeset_package` overrides the package name. When `changeset: false`, skip generation entirely.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — gate changeset generation on config
    - `packages/harness-opencode/src/autopilot/changeset-generator.ts` — accept bump + package overrides
  - verify: `bun run build && bun test`

- [ ] 3.5 **Commit settings.** `config.auto_commit` controls whether the autopilot commits after each phase (default: true). `config.commit_prefix` prepends to commit messages (e.g., `feat(auth):`). When `auto_commit: false`, changes are left unstaged for the user to review.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — respect `auto_commit` and `commit_prefix`
  - verify: `bun run build && bun test`

- [ ] 3.6 **Notification settings from config.** `config.notify_url` and `config.notify_events` replace the `--notify` CLI flag. CLI flag still overrides config. `notify_events` filters which event types trigger a webhook POST.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — read notify settings from config
    - `packages/harness-opencode/src/lib/webhook-notifier.ts` — accept event filter
  - verify: `bun run build && bun test`

- [ ] 3.7 **Rollback + checkpoint + status settings.** `config.rollback_on_failure` replaces the hardcoded `soft` in `git-safety.ts`. `config.checkpoint` (bool) controls checkpoint writes. `config.status_file` (bool) controls status file writes. `config.log_level` sets the stderr log level.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — gate checkpoint/status on config
    - `packages/harness-opencode/src/autopilot/git-safety.ts` — respect rollback setting
    - `packages/harness-opencode/src/lib/logger.ts` — accept log level from config (override env var)
  - verify: `bun run build && bun test`
