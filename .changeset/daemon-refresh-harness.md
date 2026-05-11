---
"@glrs-dev/assume": patch
---

Add daemon auto-restart for exec/credential_process commands. When the daemon dies (e.g., macOS kills it during sleep), the next credential request now silently restarts it without blocking (~1ms overhead). Also adds a containerized test harness with 13 deterministic tests covering the full daemon refresh lifecycle.
