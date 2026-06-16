---
"@glrs-dev/harness-plugin-opencode": minor
---

background jobs: soft-timeout check-ins so a never-settling watcher can't strand the session

A background job only ever woke the agent on **exit**. If a watcher's wake condition never became true (a wedged `until` loop, a CI run that hangs, a watched state that never arrives), the job ran on and the idle agent was never woken — stuck until a human poked it.

`background_run` now takes an optional `soft_timeout_seconds` (default 300, `0` disables, min 30s). While the agent is idle and the job is STILL running, it gets re-notified every interval — a soft check-in, not a deadline: the job is never killed. The agent reads the tail and decides to keep waiting (end the turn; the next interval checks back) or `background_stop` it. Jobs that finish before the first interval never trigger it, so the cost falls only on genuinely long idle waits; known-long backfills raise the interval.

Implementation reuses the existing idle poller in `background-notifier` (it already ticks every 3s while jobs run, delivering on completion) — the new path just adds a second delivery type (`selectSoftTimeoutNotices` / `buildHeartbeatNotice`), period-deduped per job so each interval fires at most once, and idle-only so it never interrupts active work. Legacy jobs whose meta predates the field default to the cadence, so the safety net applies retroactively.
