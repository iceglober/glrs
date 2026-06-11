---
"@glrs-dev/harness-plugin-opencode": patch
---

Two runtime fixes found by sandboxed harness evals, plus a sandbox tool denylist.

- **`tool.execute.before` middleware was never chained in the plugin entry** — the foreground-sleep guard and the in-flight-subagent counter (which suppresses loop-guard hard aborts while children run) were dead code at runtime. Now chained.
- **MCP tools no longer fail with "The \"data\" argument must be of type string"** — the identical-result loop signal hashed `output.output` unconditionally; MCP tools can reach the after-hook with a non-string output and the throw surfaced as the tool itself failing.
- **New `GLRS_TOOL_DENYLIST` env** (comma-separated globs, e.g. `linear_save_issue,linear_create_*`): hard-blocks matching tools with a teaching error telling the model to state the intended mutation instead of performing it. Built for sandboxed eval runs that must not mutate real trackers.
