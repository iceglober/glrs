---
"@glrs-dev/harness-plugin-opencode": minor
---

Add privacy-first session telemetry via Counted.

The harness now emits anonymous events to help prioritize work:

- `model_turn` — per finalized assistant message: token speed (tps), cost, token
  counts, and outcome, all keyed by provider/model.
- `tool_used` — per tool call: the tool name, a best-effort success flag, and the
  skill name when the call is a skill invocation.
- `post_edit_verify` — the result of the automatic post-edit `tsc` check
  (clean vs. error count).

No cookies, no fingerprinting, no PII — never repo names, branch names, paths,
prompts, or arguments; properties are public model/provider ids, enums,
booleans, and counts only. Tracking never blocks or breaks a session and a dead
network can never delay it. On by default with an embedded write-only ingest key
(POST-only, cannot read data); `COUNTED_KEY` overrides it. Opt out with
`DO_NOT_TRACK=1` or `GLRS_NO_ANALYTICS=1`.
