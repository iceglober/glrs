---
"@glrs-dev/assume": minor
---

`gsa` MCP server now detects stale sessions and fails fast instead of hanging, and adds a `check_session` tool.

Previously, when the AWS SSO session expired mid-run, `run_with_credentials` would hang on the dead credential endpoint until the MCP client gave up with an opaque `-32001 Request timed out` — the agent couldn't tell a stale session from a genuine command failure, and had no way to prompt re-auth.

- **Stale-session guard:** before running (and again if the command times out or fails), `run_with_credentials` checks session health via the existing needs-login marker / refresh-token expiry. When the session can't produce credentials it returns a structured `{ session_stale: true, action: "gsa login aws", … }` result and fires a desktop notification, instead of hanging or returning a raw error.
- **Execution timeout:** new optional `timeout_ms` (default 120000, max 600000). A hung command is killed and returns a clear timeout — which also re-checks session health — rather than blocking until the client times out. Accepts a number or numeric string.
- **`check_session` tool:** returns `{ valid, needs_login, session_expires_at, refresh_expires_at, action }` so an agent can verify the session at start-of-task or after a failure. Re-auth itself remains a user-run browser flow (`gsa login aws`); the agent can now detect and surface the need immediately.
