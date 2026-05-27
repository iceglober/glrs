---
"@glrs-dev/autopilot": patch
---

Fix crash recovery: catch thrown exceptions (socket errors, fetch failures) in retry loop instead of letting them kill the run
