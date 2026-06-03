---
"@glrs-dev/cli": patch
---

fix(cli): make `glrs assume` install resilient to a missing npm, and idempotent

`glrs assume <cmd>` hardcoded `npm i -g @glrs-dev/assume`, so on a Bun-only
machine — where `glrs` itself runs — the one package manager guaranteed present
was never tried, and install dead-ended at "npm not found".

- Probe `npm → bun → pnpm → yarn` and install with the first that exists. Bun
  is always available under `glrs`, so a working install can't hit a true dead
  end. If none exist, fail with a copy-pasteable `bun add -g @glrs-dev/assume`.
- Lazy install (`glrs assume login`, etc.) is idempotent: a working `gsa` on
  PATH short-circuits to a no-op; after installing it re-verifies `gsa` is
  reachable and otherwise prints PATH guidance for the chosen manager.
- `glrs assume init` stays convergent — legacy `@glorious/assume` cleanup still
  runs (npm-only, since that's the only way it could have been installed).
