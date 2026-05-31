---
"@glrs-dev/assume": minor
---

Reliable auto-refresh and rebrand to glrs-assume

**Auto-refresh reliability** — SSO sessions now stay alive for the full 7-day refresh window without manual intervention:

- Inline refresh in every CLI command: when the daemon isn't running and the session is expired but the refresh token is valid, any `gsa` command refreshes inline instead of showing "expired"
- Credential endpoint retry: when AWS CLI/SDK hits the daemon's HTTP endpoint with an expired session, the endpoint refreshes the token and retries automatically (no more 503s)
- `status` and `shell-init` now restart the daemon if it's dead (`BackgroundEnsure`), so every new terminal and every status check keeps the daemon alive
- Auto-install launchd agent on `gsa login` — the daemon survives reboots without requiring `gsa serve --install`
- SIGTERM handling in the daemon for clean shutdown when launchd stops the service
- launchd plist improvements: `KeepAlive.SuccessfulExit=false` (eliminates 10s respawn polling loop), `ProcessType=Background` (prevents App Nap from suspending the refresh loop), `AbandonProcessGroup` (clean shutdown)

**Rebrand** — `gs-assume` renamed to `glrs-assume` across binary names, config paths (`~/.config/glrs-assume`), env vars (`GLRS_ASSUME_*`), launchd label, shell functions, and all user-facing output. The `gsa` short alias is unchanged.
