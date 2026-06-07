---
"@glrs-dev/assume": patch
---

Soften the stale-session guidance from `gsa run_with_credentials` so an agent can self-recover in interactive sessions.

The stale-session message now tells the agent it MAY launch `gsa login <provider>` in the background (which opens the browser for the user to complete) and then poll the `check_session` tool until valid, rather than always asking the user to run the command. In headless/remote contexts it still falls back to asking the user. Retries are gated on `check_session` reporting valid.
