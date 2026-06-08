---
"@glrs-dev/harness-plugin-opencode": minor
---

`background_run` now takes an optional `title` — a short human label shown in job listings, the chat.message banner, and `background_check`/`background_list` instead of the raw command (which can be a long one-liner). Falls back to the (clipped) command when no title is given. The example TUI sidebar displays the title too.
