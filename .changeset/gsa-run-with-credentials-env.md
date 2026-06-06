---
"@glrs-dev/assume": minor
---

`gsa` MCP tool `run_with_credentials` now accepts an optional `env` parameter for additional environment variables.

Agents can pass repo-specific env vars (cert paths, confirmation flags, service addresses, …) alongside the injected AWS credentials — a pure pass-through, no repo knowledge on gsa's side. The command still runs in the gsa MCP server's working directory (the workspace root it was launched in), so relative paths work like the bash tool.

```
run_with_credentials(
  command: "node_modules/.bin/tsx scripts/tsx/backfill.ts",
  context: "production / developer",
  env: { "CONFIRM_PRODUCTION": "yes", "TEMPORAL_NAMESPACE": "kn-prod" }
)
```

Values must be strings; invalid names or non-string values return a clear invalid-params error. The gsa-injected `AWS_*` credential and region vars take precedence and cannot be overridden by `env`. Env var names (not values) are recorded in the audit log.
