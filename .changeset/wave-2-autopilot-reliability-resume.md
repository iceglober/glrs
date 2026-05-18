---
"@glrs-dev/harness-plugin-opencode": minor
---

Wave 2 — autopilot execution reliability and resume.

- **Transient error retry.** `sendAndWait` errors classified as transient (network blips, 429, 5xx, throttling) trigger up to 3 attempts with exponential backoff (1s → 2s → 4s, capped at 30s). Permanent errors (400, validation) fail immediately.
- **Resume from checkpoint.** `--resume` reads `.agent/autopilot-checkpoint.json` and skips already-completed phases (when the checkpoint's `planPath` matches the current `--plan`). The checkpoint is written atomically after each phase and deleted on successful run completion.
- **Adaptive stall timeout.** The per-iteration stall timeout now adapts to the model tier: deep=30m, mid=15m, mid-execute/autopilot-execute=10m, fast=5m. Override with `--stall-timeout <ms>`.
- **Graceful shutdown.** SIGINT/SIGTERM triggers a graceful shutdown: aborts the current iteration, commits any working-tree changes as `[WIP] autopilot interrupted`, writes a checkpoint, then exits. A second signal force-exits with code 130.
- **Phase-level git safety.** In `--fast` mode, a failed phase soft-resets to the pre-phase HEAD so the user gets a clean state with all changes preserved in staging. Interactive mode leaves the work in place for manual review.
- **Credential refresh detection.** API errors classified as `credential-expired` (AWS STS, Azure token) write a checkpoint and exit with code 2 + a clear message: "Run `gs-assume` and then `glrs oc autopilot --resume`."
- **Per-phase iteration budget.** `--max-iterations-per-phase` (default: deep=5, mid-execute/fast=10) caps a single phase's iteration count. A phase that hits its budget without completing logs a warning, writes a checkpoint, and the run continues to the next phase rather than terminating.
