---
"@glrs-dev/harness-plugin-opencode": minor
---

Add background command tools so long-running work can outlive the ~30s tool timeout.

opencode cancels a tool/MCP call after ~30s (`-32001 Request timed out`), so multi-minute backfills/migrations/builds can't run inline. New tools launch a command **detached** (own process group, stdio to a per-job dir, parent unref'd) — it survives both the timeout and an MCP-server/opencode restart — and record the exit code to disk for later polling:

- `background_run(command, with_gsa?, env?, cwd?)` — returns a job id in <1s.
- `background_check(job_id)` — running / exited (with code) / failed, runtime, bounded stdout+stderr tails.
- `background_list()` / `background_stop(job_id)` — enumerate and terminate (kills the whole process group).

One general tool set covers both credential and non-credential work: the optional `with_gsa` field takes a gsa context name and wraps the command in `glrs-assume exec -c <ctx>` to inject AWS credentials (gsa-injected vars take precedence over caller `env`); omit it for ordinary commands. If `with_gsa` is set but the gsa binary isn't on PATH, it errors clearly rather than running uncredentialed.

The command runs inside a subshell so a bare `exit N` can't skip the exit-code capture.
