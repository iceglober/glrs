---
"@glrs-dev/harness-plugin-opencode": minor
---

Background jobs are now isolated per session. `background_run` stamps each job with the launching session's id; the `chat.message` banner and `background_list` show only the current session's jobs (and the example sidebar filters by `props.session_id`). A job with no session id (started by an older harness) is treated as global and shown everywhere, so nothing disappears on upgrade.
