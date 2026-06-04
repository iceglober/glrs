---
"@glrs-dev/assume": patch
---

Surface a needs-relogin provider even when its refresh token hasn't timestamp-expired.

GCP stamps its refresh token with a 10-year expiry, so when Google rejects a background refresh — e.g. an org reauth challenge (`invalid_grant` / `invalid_rapt`) — the dead-session banner stayed silent and the raw token-endpoint JSON leaked through. The daemon now writes a per-provider `needs-login` marker whenever a refresh is genuinely rejected; the banner fires on that marker (not only on the timestamp), and any successful token store clears it. The hint wording now covers both AWS SSO expiry and GCP reauth: "session needs re-authentication — run: gsa login <provider>".
