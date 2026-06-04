---
"@glrs-dev/assume": minor
---

Restore ambient credentials and make them robust across providers and re-logins.

- **Per-provider ambient defaults.** AWS and GCP each hold their own machine-global default context, both served in every shell at once. Replaces the single `active.json` with a per-provider default store (`defaults/<provider>.json`); a transparent one-time migration folds any existing `active.json` forward.
- **`gsa login` preserves your default.** A re-login after SSO expiry no longer drops you to "no context" — it keeps the prior default when still valid, ending the "must `gsa exec` for everything after every re-login" regression.
- **`gsa use` is a per-shell override**; new `--default` flag also sets the machine default. `gsa exec` with no `-c`/`--provider` injects every provider's default.
- **Always-on prompt.** Renders one `[provider:ctx]` bracket per provider (`*` marks a per-shell override), seeded from defaults so a brand-new shell shows the ambient default, and a dim `[gsa]` when nothing is active. New `prompt.layout = "above" | "inline"` (default two-line).
- **Stale-daemon recovery.** The daemon records its version; CLI commands cycle a running-but-outdated daemon left behind by an auto-upgrade.
- **Dead-session is surfaced loudly.** When a provider you use ambiently has an expired refresh token, the next command prints an actionable re-login hint instead of relying on a desktop notification.
