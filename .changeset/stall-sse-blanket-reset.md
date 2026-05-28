---
"@glrs-dev/adapter-opencode": patch
"@glrs-dev/cli": patch
---

Fix stall detection: remove blanket resetStall on SSE heartbeats — only tool calls and text deltas indicate real activity
