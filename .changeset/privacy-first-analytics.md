---
"@glrs-dev/cli": minor
---

Add privacy-first product analytics via Counted.

`glrs` now sends anonymous usage events (which command ran, plus non-PII flags
like success/failure and counts) to help prioritize work. No cookies, no
fingerprinting, no PII — never repo names, branch names, paths, or arguments.
Tracking never blocks or fails a command, and a dead network can never delay
exit. Opt out with `DO_NOT_TRACK=1` or `GLRS_NO_ANALYTICS=1`.
