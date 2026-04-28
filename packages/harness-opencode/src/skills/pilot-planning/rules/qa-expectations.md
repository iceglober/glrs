# Rule 10 — QA-expectations establishment

**Detect → propose → confirm per-surface verify patterns.**

A plan's verify commands are its contract with the builder. Generic verifies ("run tests") waste builder time; specific verifies ("run the API tests that exercise the files this task touches") catch real failures. This rule establishes concrete, per-surface QA expectations with the user before emitting the plan.

## The six surfaces

For each surface below, detect signals in the codebase, propose a canonical verify pattern, and confirm with the user.

### UI — Browser-based user interface

**Detection signals:**
- `@playwright/test`, `cypress`, or `@vitest/browser` in `package.json` dependencies
- `playwright.config.{ts,js}` or `cypress.config.*` present

**Proposed verify pattern:**
Playwright MCP invocation for visual/interaction assertions:
```yaml
verify:
  - playwright test --project=chromium --grep "@task-specific-tag"
```

### API — HTTP endpoints

**Detection signals:**
- `openapi.yaml` / `openapi.json` present
- `curl` or `httpie` usage in existing scripts
- Postman collection files

**Proposed verify pattern:**
Direct HTTP assertion against a local port:
```yaml
verify:
  - curl -fsS http://localhost:3000/health | jq '.status == "ok"'
```

### DB — Database schema and queries

**Detection signals:**
- `docker-compose` postgres service defined
- `prisma`, `drizzle-kit`, `knex`, or `flyway` in dependencies
- `test/db` or similar helper directory

**Proposed verify pattern:**
Postgres readiness + migration + assertion:
```yaml
verify:
  - pg_isready -h localhost -p 5432
  - pnpm prisma migrate deploy
  - pnpm tsx scripts/verify-db.ts
```

### Integration — Cross-module workflows

**Detection signals:**
- `test/integration/**` directory exists
- `e2e/**` directory exists
- `*.integration.test.ts` files

**Proposed verify pattern:**
Integration test runner scoped to relevant paths:
```yaml
verify:
  - pnpm test test/integration
```

### Browser-based component — Storybook stories

**Detection signals:**
- `storybook` or `@storybook/*` in dependencies
- `*.stories.{ts,tsx}` files present

**Proposed verify pattern:**
Storybook test or Chromatic visual verification:
```yaml
verify:
  - pnpm storybook test --stories "ComponentName"
```

### CLI — Command-line interface

**Detection signals:**
- `bin/*` directory with executables
- `package.json` `bin:` entry defined

**Proposed verify pattern:**
Smoke test via help flag or scripted invocation:
```yaml
verify:
  - pnpm my-cli --help
  - pnpm tsx scripts/smoke-test-cli.ts
```

## Question-bundling rule

**Two or more surfaces detected:** Bundle into a single structured `question` tool call with one checkbox group per surface.

**One surface detected:** Still ask (confirmation, not interrogation), but use a single-field call.

**Zero surfaces detected:** Skip the QA-expectation question entirely. Fall back to generic verifies:
```yaml
defaults:
  verify_after_each:
    - pnpm run typecheck
    - pnpm test
```

## Emission

Confirmed patterns become:

1. **Per-task verify templates** — tasks targeting specific files use scoped verifies (e.g., `pnpm test test/api/users.test.ts` for a task touching `src/api/users.ts`)
2. **defaults.verify_after_each** — global breakage catchers (typecheck, full test suite)

The rule: per-task verify targets the specific files touched; defaults catches global breakage.

## Cross-reference to verify-design.md

This rule (10) is the per-surface tactical layer — it names the tools to detect and the patterns to propose. Rule 3 (verify-design.md) owns the principles: deterministic, assertive, would-have-failed-before. Every proposed command must satisfy both layers.
