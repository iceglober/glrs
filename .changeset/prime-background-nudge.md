---
"@glrs-dev/harness-plugin-opencode": patch
---

PRIME now tells the agent to background long-running commands. The `prime-ultra` prompt gained a short rule: commands that can exceed the ~30s tool timeout (backfills, migrations, long builds, prod scripts) must use `background_run`/`background_check` instead of running inline, with `with_gsa: "<context>"` for credential-injected (AWS/prod) commands. Drives adoption of the background tools added in 3.8.0.
