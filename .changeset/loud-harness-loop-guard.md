---
"@glrs-dev/harness-plugin-opencode": minor
---

Harness telemetry now segments by provider/model on every event, and a new tool-loop guard interrupts models that spin without making progress.

**Telemetry — provider/model on all events.** `tool_used` and `post_edit_verify` now carry `provider` and `model` (defaulting to `"unknown"`), matching `model_turn`, so all three harness events can be sliced by the same dimensions in Counted. The active provider/model is tracked per session from each assistant `message.updated`. (`model_turn` already emitted the full token + cache shape — `input_tokens`/`output_tokens`/`reasoning_tokens`/`cache_read`/`cache_write` — and was already mapped correctly; tool/verify events carry no token data so cache props don't apply there.)

**Tool-loop guard.** Detects a model stuck calling tools without converging — a long passive-exploration streak (consecutive `read`/`grep`/`glob`/`list`/`webfetch` with no intervening edit, command, or subagent) or the same `tool+args` signature repeated (failures weighted double, so a repeatedly-failing call trips ~2× faster). Intervention escalates: a corrective is first injected into the tool output, and if the loop continues it hard-aborts the runaway turn via `session.abort` and queues a re-plan prompt. Emits a `loop_detected` telemetry event. All thresholds and an `abortEnabled` master switch are configurable under `loopDetection`; the existing same-file `checkEditLoop` warning is unchanged.
