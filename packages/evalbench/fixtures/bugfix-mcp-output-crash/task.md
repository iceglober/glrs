Bug report: in headless harness runs, EVERY Linear MCP tool call (linear_get_issue, linear_list_comments, ...) fails with:

  The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received undefined

Built-in tools (read, grep, bash) work fine. The Linear MCP server itself is healthy — the same calls succeed from other clients. The failure appeared after the recent loop-guard changes in packages/harness-opencode.

Diagnose the root cause and fix it. The fix must not weaken the loop guard for built-in tools. Add or update a test that would have caught this. Finish with a summary of the root cause and your fix.
