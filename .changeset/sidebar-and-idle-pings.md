---
"@glrs-dev/harness-plugin-opencode": minor
---

Fix two background-jobs gaps: the sidebar never showing up from a published install, and idle completion pings never firing.

- **Sidebar now auto-registers on install.** The background-jobs sidebar ships as the harness's `./tui` export, but opencode loads each `plugin`-array entry independently — the sidebar only activates when `@glrs-dev/harness-plugin-opencode/tui` is its OWN entry. The installer used to write only the server tuple, so the sidebar never appeared from a published install (it worked only when a developer ran `opencode plugin <pkg>` by hand). `glrs-oc install` now adds the `/tui` entry on every path, including the "already configured" upgrade case. The subpath is intentionally unpinned — a versioned `…@x/tui` collapses to the same plugin name as the server entry and would be deduped away, never registering.

- **Idle completion pings now actually fire.** `session.idle` fires once, when the turn ends — but the common case is an agent that backgrounds a job and goes idle *immediately*, while the job is still running. The old one-shot idle check found nothing fresh and there was no later event when the job exited, so the agent — told it would be notified and so no longer polling — waited forever. The idle handler now arms a short, unref'd poller when it sees jobs still running for the session; it watches the on-disk job state and pushes the completion notice the moment they finish, then disarms. Dedup with the tool-output channel is unchanged (shared announce-ledger), so each completion is still surfaced exactly once.
