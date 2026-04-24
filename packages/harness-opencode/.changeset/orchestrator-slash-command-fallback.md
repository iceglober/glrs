---
"@glrs-dev/harness-opencode": patch
---

Orchestrator now recognizes plugin-provided slash commands (`/fresh`, `/ship`, `/review`, `/autopilot`, `/research`, `/init-deep`, `/costs`) when they appear as the first token of the first user message and weren't dispatched by the OpenCode TUI. In that case the orchestrator reads the command template from the bundled plugin cache, substitutes `$ARGUMENTS`, and executes it inline — same as if the TUI had dispatched normally.

Context: some sessions receive the raw slash-command text as a plain user message (TUI dispatch silently misses for reasons we haven't pinned down — copy-paste, certain keyboard shortcuts, etc.). Without a fallback, the orchestrator would improvise, e.g. interpret `/fresh meeting prep` as "do something fresh-ish" and go hunting for `gs wt` subcommands instead of running `/fresh`. Prompt-only change; no runtime behavior outside the orchestrator prompt itself. Unknown `/<token>` commands and mid-message slashes still fall through to normal Phase 1 — fallback is scoped tightly to the seven shipped commands at start-of-first-message only.
