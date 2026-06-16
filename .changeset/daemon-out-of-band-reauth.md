---
"@glrs-dev/assume": minor
---

feat(assume): daemon-driven out-of-band browser re-auth on session lapse

When a provider session lapses (AWS SSO ended, or GCP's `invalid_rapt` reauth window closed), the daemon now opens a browser to re-authenticate out-of-band instead of only flagging needs-login and waiting for a hand-run `gsa login`. On success it stores fresh tokens, clears the needs-login marker, and restores the provider to active — so already-open shells, the MCP `run_with_credentials` tool, and apps reading GCP ADC recover without manual steps.

- New `Provider::supports_daemon_reauth` / `daemon_reauth`: AWS reuses the SSO device flow, GCP refreshes only ADC (single browser, also avoids the second `gcloud auth login` browser).
- New `reauth` RPC; the MCP stale-session path triggers it and tells the agent to poll `check_session` rather than asking the user to confirm a re-login.
- Gated by `[providers.<id>] auto_reauth` (default on), with a 5-minute cooldown so a dismissed browser doesn't re-pop every refresh tick.
