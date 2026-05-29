---
"@glrs-dev/harness-plugin-opencode": patch
---

feat(harness): stall detector plugin + anti-stall prompt rules

Two-layer defense against the stall pattern (model describes next steps then stops generating without executing):

**Layer 1: Stall detector plugin** (evidence-backed, Wink 2026 pattern)
- Watchdog timer starts when an assistant message finalizes
- If no tool call arrives within 45 seconds, sends a continuation nudge to the session via the SDK client (`session.promptAsync`)
- Max 3 nudges per session to prevent infinite loops
- Tracks `agent.stall.nudge` telemetry events

**Layer 2: Prompt-level anti-stall rules**
- Iron-law: "NEVER STOP MID-TASK"
- Self-check instruction before ending turns
- Common stall patterns enumerated
- Added to: prime, prime-ultra, plan, plan-ultra, build, build.open
