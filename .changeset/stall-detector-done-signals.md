---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): suppress stall detector on completion messages

The stall detector was nudging sessions that had legitimately finished — "STATUS: DONE", "no further action", "PR is open". Now checks the last message text for completion signals before firing the watchdog.
