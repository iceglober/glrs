---
"@glrs-dev/harness-plugin-opencode": patch
---

Loop guards now catch the Gemini Flash runaway pattern: MCP re-fetch loops and thinking spirals.

Diagnosed from a real PRIME-on-Gemini-3.5-Flash session that looped for an hour with zero intervention: it re-fetched the same Linear issues (`linear_get_issue`, `linear_list_comments`) with byte-identical results, then died on a 106-second turn of pure reasoning with no output. Three gaps, three fixes:

- **MCP read tools count as exploration.** The passive-tool set was the five builtins only, so every `linear_get_*`/`*_list_*` call counted as "forward progress" and reset the exploration streak — 15+ consecutive read-only calls never accumulated a single warning. Tools whose verb segment is a read verb (get/list/search/fetch/…) are now passive; write verbs (save/create/update/…) and verify/poll steps (`tsc_check`, `background_check`) stay active.
- **Identical-result re-fetches weigh double**, like failures. The repeat guard counted call signatures, so rotating among four issue ids stayed under threshold despite every result already being in context. The guard now hashes tool output: same call + same output trips the warn a full call earlier, and the corrective tells the model the data is byte-identical to what it already has.
- **Thinking-spiral recovery.** A turn that ends with reasoning only — no text part, no tool call — matched nothing: the stall detector's intent patterns need message text. The stall detector now inspects the final assistant message at `session.idle` and pushes a bounded corrective (max 2 per session) telling the model to state its conclusion and act. Aborted/errored turns (user pressed esc) are skipped.

The shipped test suite replays the actual session's 15-call tail and asserts the guard fires by call 12.
