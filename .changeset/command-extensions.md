---
"@glrs-dev/harness-plugin-opencode": patch
---

feat(harness): all commands read `.glrs/extensions/<command>.md`

All workflow commands (/ship, /fresh, /review, /research, /init-deep) now read an optional extension file from the repo and append it to the command prompt. Repos can customize command behavior without forking the harness.
