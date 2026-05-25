---
"@glrs-dev/cli": patch
---

Autopilot now auto-recovers when a prior crashed run left an inconsistent `spec/` directory (stale spec — no more "phase file referenced in spec/main.yaml does not exist" deadlock). When the loop fails, the CLI now prints the actual error Reason and exits with a non-zero exit code so CI and shell scripts can detect failure.
