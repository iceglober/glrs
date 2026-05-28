---
"@glrs-dev/adapter-opencode": patch
"@glrs-dev/cli": patch
---

Fix stall timer: cost polling events no longer reset the timer, so hung connections are detected within 90 seconds
