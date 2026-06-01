# Per-user Postgres-backed rate limiting

## Goal

Add per-user sliding-window rate limiting to the Express API, backed entirely by Postgres (no Redis). Quotas differ for read (GET) vs write (POST/PUT/DELETE) endpoints. Admin users (`role === 'admin'`) bypass entirely. When a caller exceeds their quota, the API returns HTTP 429 with a `Retry-After` header (seconds). All existing tests must continue to pass unchanged. A new test file exercises 429 behavior, header correctness, admin bypass, and read-vs-write category separation, using low quotas overridden via environment variables.

## Constraints

- Postgres only — no new infra dependencies, no Redis, no in-memory store (the API may run multi-process behind a load balancer).
- Sliding window, not fixed bucket — rate counting must look back exactly `window_seconds` from "now," not from a wall-clock bucket boundary.
- Must not break existing tests. Existing tests in `test/users.test.ts`, `test/posts.test.ts`, `test/auth.test.ts`, `test/analytics.test.ts`, `test/pagination.test.ts`, `test/search.test.ts` all `TRUNCATE users RESTART IDENTITY CASCADE` in `beforeEach` but do NOT truncate the new `rate_limit_requests` table. Default production quotas must therefore be high enough that an entire test run never trips them (existing tests make at most ~20 requests per file).
- Quotas must be overridable for the rate-limit test file via env vars, so the test can set tight quotas (e.g. 3/min) without polluting other tests.
- The middleware must work for both authenticated requests (key by `userId`) and unauthenticated requests (key by client IP) — public GETs like `GET /api/posts` do not run `requireAuth`.
- Admin bypass must NOT consume a quota slot (no row inserted into `rate_limit_requests` for admin requests).
- The new migration `migrations/005_rate_limiting.sql` is run automatically by every test file's existing `beforeAll` loop (it reads all `*.sql` files from `migrations/` sorted). It must be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: A migration file exists that creates a rate_limit_requests table
          tracking (key, category, created_at) plus a supporting index for
          fast windowed counts. Running it twice in a row does not error,
          so it composes with the existing test bootstrap that runs every
          *.sql file on each test's beforeAll.
  files:
    - migrations/005_rate_limiting.sql (NEW)
      Change: Idempotent CREATE TABLE IF NOT EXISTS rate_limit_requests with columns id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL, category TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); plus CREATE INDEX IF NOT EXISTS on (key, category, created_at DESC).
  tests:
    - test/rateLimit.test.ts::"migration creates rate_limit_requests table with required columns"
  verify: bun test test/rateLimit.test.ts -t "migration creates rate_limit_requests table"

- [x] id: a2
  intent: A rate-limit middleware module exports (a) a middleware function
          mounted app-wide before routers, (b) a config object whose default
          values come from environment variables RATE_LIMIT_READ_MAX,
          RATE_LIMIT_WRITE_MAX, RATE_LIMIT_WINDOW_SECONDS with safe production
          defaults of 1000 read/min, 100 write/min, window=60s. Tests can
          import the config object and mutate it (or set env vars before
          import) to use tight quotas.
  files:
    - src/middleware/rateLimit.ts (NEW)
      Change: Export `rateLimitConfig` object with readMax/writeMax/windowSeconds, default-loaded from env vars with documented production-safe fallbacks; export `rateLimit` middleware function.
  tests:
    - test/rateLimit.test.ts::"rateLimitConfig exposes overridable readMax/writeMax/windowSeconds"
  verify: bun test test/rateLimit.test.ts -t "rateLimitConfig exposes"

- [x] id: a3
  intent: For an authenticated non-admin user, the middleware identifies the
          caller by userId (extracted via verifyToken on the Authorization
          header — no DB lookup for identification, only for role) and
          counts that user's recent requests against the appropriate
          read/write quota using a sliding window. When over quota, the
          response is HTTP 429 with body { error: "Rate limit exceeded",
          retryAfter: <seconds> } and a Retry-After header equal to the
          number of seconds until the oldest counted request falls out of
          the window (minimum 1, rounded up).
  files:
    - src/middleware/rateLimit.ts
      Change: Implement sliding-window logic — SELECT MIN(created_at) and COUNT(*) FROM rate_limit_requests WHERE key=$1 AND category=$2 AND created_at > NOW() - make_interval(secs => $3); if COUNT >= max, compute retryAfter from MIN(created_at) and return 429; otherwise INSERT a new row and call next().
    - src/app.ts
      Change: Import rateLimit middleware and mount it via app.use(rateLimit) AFTER express.json() and express.static() but BEFORE the four routers, so it runs on every /api/* call.
  tests:
    - test/rateLimit.test.ts::"authenticated user gets 429 after exceeding read quota"
    - test/rateLimit.test.ts::"429 response includes Retry-After header in seconds"
    - test/rateLimit.test.ts::"429 response body has error and retryAfter fields"
  verify: bun test test/rateLimit.test.ts -t "429"

- [x] id: a4
  intent: Read and write categories are tracked in separate counters. A user
          who exhausts the read quota can still make write requests (until
          the write quota is also exhausted), and vice versa. The category
          is determined by HTTP method: GET => "read", everything else =>
          "write".
  files:
    - src/middleware/rateLimit.ts
      Change: Categorize each request by req.method (GET → "read", else → "write") and count/insert against that category only.
  tests:
    - test/rateLimit.test.ts::"read and write quotas are tracked independently"
  verify: bun test test/rateLimit.test.ts -t "read and write quotas"

- [x] id: a5
  intent: A user whose role is 'admin' bypasses rate limiting completely —
          no 429 is ever returned to them, and their requests do NOT
          insert rows into rate_limit_requests (so they do not consume
          quota slots that would later affect another user keyed the
          same way).
  files:
    - src/middleware/rateLimit.ts
      Change: After resolving role from users table for an authenticated request, if role === 'admin' call next() immediately without counting or inserting.
  tests:
    - test/rateLimit.test.ts::"admin user bypasses rate limit entirely"
    - test/rateLimit.test.ts::"admin requests do not insert rate_limit_requests rows"
  verify: bun test test/rateLimit.test.ts -t "admin"

- [x] id: a6
  intent: Unauthenticated requests (no Authorization header, or invalid
          token) are rate-limited by client IP rather than userId, using
          the same read/write quotas. This protects public GET endpoints
          and the /api/auth/login and /api/auth/register endpoints from
          abuse.
  files:
    - src/middleware/rateLimit.ts
      Change: When verifyToken returns null or no Authorization header is present, key on `ip:${req.ip}` instead of `user:${userId}`.
  tests:
    - test/rateLimit.test.ts::"unauthenticated requests are rate-limited by IP"
  verify: bun test test/rateLimit.test.ts -t "unauthenticated requests are rate-limited by IP"

- [x] id: a7
  intent: All six existing test files continue to pass without modification.
          The default production quotas (1000 read/min, 100 write/min) are
          high enough that an entire test run — which makes at most ~20
          requests per file — does not approach them, even though the
          rate_limit_requests table is not truncated between tests.
  files:
    - (no source change; this item is a verification gate)
  tests:
    - test/users.test.ts::"POST creates a user"
    - test/users.test.ts::"GET lists users"
    - test/users.test.ts::"GET /:id returns user"
    - test/users.test.ts::"GET /:id 404"
    - test/users.test.ts::"DELETE works"
  verify: bun test test/users.test.ts
```

## File-level changes

### migrations/005_rate_limiting.sql

- Change: Create new migration file. Contents: idempotent `CREATE TABLE IF NOT EXISTS rate_limit_requests (id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL, category TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` plus `CREATE INDEX IF NOT EXISTS rate_limit_requests_lookup_idx ON rate_limit_requests (key, category, created_at DESC)`.
- Why: Sliding-window counter needs persistent per-(key, category) timestamped rows. Index accelerates the windowed count query.
- Risk: low — new table only, no foreign keys, no changes to existing tables.
- Mirror: `migrations/004_search.sql` (same `IF NOT EXISTS` style and migration filename pattern).
- Verify: `bun test test/rateLimit.test.ts -t "migration creates rate_limit_requests table"`

### src/middleware/rateLimit.ts

- Change: New file. Exports `rateLimitConfig` (object with `readMax`, `writeMax`, `windowSeconds`, defaults from env or 1000/100/60) and `rateLimit` async middleware. Middleware logic:
  1. Read `Authorization` header; if `Bearer <token>`, call `verifyToken` (sync, signature-only, no DB).
  2. If valid token → look up `role` from `users` table by `userId`. If `role === 'admin'`, call `next()` and return — no count, no insert.
  3. Determine `key`: `user:<userId>` if authenticated non-admin, else `ip:<req.ip>`.
  4. Determine `category`: `req.method === 'GET' ? 'read' : 'write'`.
  5. Determine `max`: `category === 'read' ? rateLimitConfig.readMax : rateLimitConfig.writeMax`.
  6. Single SQL: `SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM rate_limit_requests WHERE key=$1 AND category=$2 AND created_at > NOW() - make_interval(secs => $3)`.
  7. If `count >= max`: compute `retryAfter = max(1, ceil(windowSeconds - (now - oldest)))`, set `Retry-After` header, return `res.status(429).json({ error: "Rate limit exceeded", retryAfter })`.
  8. Otherwise: `INSERT INTO rate_limit_requests (key, category) VALUES ($1, $2)` and `next()`.
- Why: Sliding-window keyed by stable user ID (or IP) with per-category quotas, all enforced in a single round-trip read + conditional write.
- Risk: medium — adds one or two SQL queries on every API request; index makes the read O(log n + k). The non-admin authenticated path performs an extra `users` lookup; this duplicates work `requireAuth` does later, but is needed because rate limiting runs before per-route middleware.
- Mirror: `src/middleware/auth.ts` (same module shape, same `Request/Response/NextFunction` import pattern, same `pool.query` usage).
- Verify: `bun test test/rateLimit.test.ts`

### src/app.ts

- Change: Import `rateLimit` from `./middleware/rateLimit.js`. Insert `app.use(rateLimit)` between line 11 (`app.use(express.static(...))`) and line 12 (`app.use("/api/auth", authRouter)`). All four routers stay in place; no other edits.
- Why: Mounting at app level (before routers) ensures rate limiting runs for all `/api/*` paths, both authenticated and unauthenticated, with one mount.
- Risk: low — additive, single-line change. No changes to existing router order, error handler, or static serving.
- Verify: `bun test test/users.test.ts && bun test test/rateLimit.test.ts`

### test/rateLimit.test.ts

- Change: New file. Mirrors the structure of `test/users.test.ts`:
  - `beforeAll`: set env vars `RATE_LIMIT_READ_MAX=3`, `RATE_LIMIT_WRITE_MAX=2`, `RATE_LIMIT_WINDOW_SECONDS=60` BEFORE importing `app` / `rateLimitConfig`. Run all migrations from `migrations/` (same loop as existing tests). Start server on port `3463` (unused by other tests — existing tests use 3457–3462 range).
  - `beforeEach`: `TRUNCATE users RESTART IDENTITY CASCADE; TRUNCATE rate_limit_requests RESTART IDENTITY` so each test starts clean. Register a normal user, register an admin user (insert directly with `role='admin'`).
  - Tests:
    1. `"migration creates rate_limit_requests table with required columns"` — query `information_schema.columns` to assert `key`, `category`, `created_at`, `id` exist.
    2. `"rateLimitConfig exposes overridable readMax/writeMax/windowSeconds"` — import `rateLimitConfig`, assert the three numeric fields equal env values.
    3. `"authenticated user gets 429 after exceeding read quota"` — make 3 GETs (succeed), 4th GET returns 429.
    4. `"429 response includes Retry-After header in seconds"` — assert header is a numeric string ≥ 1.
    5. `"429 response body has error and retryAfter fields"` — assert JSON body shape.
    6. `"read and write quotas are tracked independently"` — exhaust read quota (3 GETs, 4th 429), then a POST still succeeds (until write quota of 2 is hit).
    7. `"admin user bypasses rate limit entirely"` — admin makes 10 GETs, all return 200 (or whatever the route returns; never 429).
    8. `"admin requests do not insert rate_limit_requests rows"` — after 10 admin GETs, `SELECT COUNT(*) FROM rate_limit_requests WHERE key = 'user:<adminId>'` is 0.
    9. `"unauthenticated requests are rate-limited by IP"` — make 3 unauthenticated GETs to `/api/posts`, 4th returns 429; verify a row exists with `key LIKE 'ip:%'`.
- Why: Validates every acceptance-criteria item with concrete behavior assertions.
- Risk: low — isolated to a new test file, runs only when invoked explicitly (default `test` script only runs `test/users.test.ts`).
- Mirror: `test/users.test.ts` for `beforeAll`/`beforeEach`/server bootstrap shape.
- Verify: `bun test test/rateLimit.test.ts`

## Non-goals

- Do NOT modify `src/middleware/auth.ts`. The rate limiter does its own JWT decode + role lookup; do not refactor `requireAuth` to share code with it in this plan.
- Do NOT modify any of the existing test files (`test/users.test.ts`, `test/posts.test.ts`, `test/auth.test.ts`, `test/analytics.test.ts`, `test/pagination.test.ts`, `test/search.test.ts`).
- Do NOT add Redis, an LRU cache, or any in-memory state. All rate-limit state lives in Postgres.
- Do NOT add a periodic background cleanup job (cron, setInterval, pg_cron). Cleanup of old rows is out of scope; the index keeps the windowed query fast even with stale rows. Capture as future work.
- Do NOT add per-route or per-endpoint quota overrides beyond the read/write split. Two categories only.
- Do NOT change the default `test` script in `package.json`. The rate-limit test file is invoked explicitly via `bun test test/rateLimit.test.ts`.
- Do NOT add a global rate limit, an IP allowlist, or distinguish authenticated-vs-unauthenticated quota values. Same numeric quotas apply to both.

## Test plan

Automated:

1. `bun test test/users.test.ts` — must pass unchanged (regression gate for existing behavior under default quotas).
2. `bun test test/rateLimit.test.ts` — must pass (validates all new behavior).
3. Optional manual cross-check: run the full existing suite if any is wired up via the user's local script — `bun test test/posts.test.ts`, `bun test test/auth.test.ts`, etc. — none should regress.

Manual smoke (optional, only if running locally with the dev server):

1. `bun start`, then `for i in {1..1001}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/posts; done | tail` — should produce exclusively 200s (default quota is 1000/min, but window resets and `created_at > NOW() - 60s` keeps filtering older rows).
2. With a low override (`RATE_LIMIT_READ_MAX=3 bun start`), curl 4 GETs, last one returns 429 with `Retry-After`.

## Out of scope

- Cleanup of stale `rate_limit_requests` rows (older than `windowSeconds`). Future work: a `DELETE FROM rate_limit_requests WHERE created_at < NOW() - INTERVAL '1 hour'` running on a timer or via pg_cron. Index keeps queries fast in the meantime.
- Distributed clock skew handling (multi-node Postgres setups using replicas). Single-primary write path is assumed; `NOW()` is authoritative.
- Per-endpoint or per-router quota tuning (e.g. tighter quotas on `/api/auth/login` than `/api/posts`). The scoping fixed two categories: read and write.
- Burst smoothing or token-bucket semantics. Sliding window only.
- Surfacing the remaining quota in successful responses via `X-RateLimit-Remaining` headers. Could be added later; not required by the acceptance criteria.

## Open questions

- None blocking. The grounding summary fully resolved the keying strategy (userId vs IP), the quota magnitudes (production defaults 1000 read / 100 write per minute), the 429 body shape, and the migration's idempotency requirement.
