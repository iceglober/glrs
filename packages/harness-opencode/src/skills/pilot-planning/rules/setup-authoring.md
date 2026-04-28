# Rule 9 — Setup-block authoring

**Detect → propose → confirm the top-level `setup:` block.**

The `setup:` block runs once per worktree before any task executes. It is the environment bootstrap: package manager install, docker-compose services, migration runs. A good setup block means the builder starts with a working environment; a missing one means tasks fail confusingly on missing dependencies.

## Detection signals

During codebase research (Section 2), look for these signals:

**Lockfiles → package manager install:**
- `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`
- `bun.lock` → `bun install --frozen-lockfile`
- `package-lock.json` → `npm ci`
- `yarn.lock` → `yarn install --frozen-lockfile`
- `Cargo.lock` → `cargo fetch`

**Docker Compose → service startup:**
- `docker-compose.yml` or `compose.yaml` with defined services → `docker compose up -d <svc>` for each service the tasks will need (typically postgres, redis, etc.)

**Migration tooling → schema setup:**
- `package.json` deps containing `knex`, `prisma`, `drizzle-kit`, or `flyway` → corresponding migrate/push command (e.g., `prisma migrate dev`, `drizzle-kit push`)

## Proposal shape

When you detect one or more setup commands, bundle them into a single `question` tool call:

- Present each detected command as a pre-selected checkbox
- Group by category (Package install, Services, Migrations)
- Allow the user to uncheck commands that aren't needed or edit the command text
- Include an "Add another command" free-text field for anything you missed

Example question structure:

```
Setup commands detected (check all that should run before the first task):

[✓] Package install: pnpm install --frozen-lockfile
[✓] Services: docker compose up -d postgres
[✓] Migrations: pnpm prisma migrate dev

[Add another command: __________]
```

## No-op behavior

If NOTHING is detected (no lockfile, no compose, no migration tooling), emit `setup: []` or omit the key entirely. Do NOT ask the user open-ended "do you need setup?" questions. The schema defaults to `[]`; omitting is safe.

## Emission

Whatever the user confirms becomes the top-level `setup:` block in the written YAML, positioned above `defaults:` (matching schema ordering):

```yaml
name: my-plan
setup:
  - pnpm install --frozen-lockfile
  - docker compose up -d postgres
  - pnpm prisma migrate dev
defaults:
  verify_after_each:
    - pnpm run typecheck
tasks:
  ...
```

## Back-compat note

The `setup:` key already defaults to `[]` in the schema (line 241 of `src/pilot/plan/schema.ts`). Plans that omit it or set it to `[]` behave identically to before this rule existed.
