---
"@glrs-dev/harness-plugin-opencode": patch
---

Fix: the first message in an opencode session got no response (you had to send a second). The `chat.message` background-jobs banner (added in 3.9.0) pushed a synthetic `{type,text}` part onto the user message, but opencode's part schema requires `messageID`/`sessionID`/`id` — so `session.prompt` rejected the message ("SchemaError: Missing key at [messageID] … invalid user part before save") and produced no response. It only hit the first message because the banner then went empty. Removed the banner entirely (mutating saved user-message parts is the wrong mechanism); background jobs remain visible via the sidebar and `background_check`/`background_list`.
