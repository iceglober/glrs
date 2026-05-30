---
"@glrs-dev/cli": patch
---

fix(cli): `glrs upgrade` now writes fresh registry result to auto-update state

Previously, `upgrade` and `autoUpdate` maintained separate state. If `upgrade`
ran during npm CDN propagation delay and cached a stale version, the 1-hour
rate limit prevented `autoUpdate` from re-checking on the next command.
Now `upgrade` writes the registry result to the shared state file so both
paths stay in sync.
