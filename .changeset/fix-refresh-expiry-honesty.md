---
"@glrs-dev/assume": patch
---

fix(assume): stop fabricating the refresh-token lifetime; honest `gsa status`

`gsa status` showed "Refresh token: 6d 22h remaining" even right after auto-refresh
had failed and the SSO session ended — making it look like auto-refresh was broken.

Root cause: `refresh_expires_at` was hardcoded to `now + 7 days` and **reset on
every refresh** (AWS rotates the refresh token each time). AWS SSO never reports
the refresh token's real lifetime — it's capped by the org's IAM Identity Center
session limit (often hours), enforced server-side. So the 7-day number was pure
fiction, and the daemon also hammered refresh every tick near session end.

- `refresh()` no longer rolls `refresh_expires_at` forward on rotation; it
  preserves the ceiling set at login.
- `gsa status` no longer prints a fabricated refresh-token countdown. While the
  session is live it shows `Auto-refresh: on`; once the SSO token is expired
  (auto-refresh couldn't renew it) it shows `SSO session ended — run: gsa login`.

Auto-refresh itself was working correctly the whole time — it just can't extend
past the org's SSO session limit, which is expected AWS behavior.
