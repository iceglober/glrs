# Wave 3 — Analytics and Reporting

### 3.1 Analytics endpoints
- intent: Create `src/routes/analytics.ts` with three reporting endpoints (all require admin auth via `requireAdmin`): (a) `GET /api/analytics/overview` — returns `{total_users, total_posts, posts_last_7_days, posts_last_30_days, avg_posts_per_user}`. Use a single CTE-based SQL query. (b) `GET /api/analytics/top-authors?limit=N` — returns array of `{user_id, name, email, post_count, latest_post_at}` ordered by post_count DESC. Default limit 10. Uses a JOIN + GROUP BY. (c) `GET /api/analytics/activity?days=N` — returns daily breakdown `{date, new_users, new_posts}` for the last N days (default 30). Uses `generate_series` to include days with zero activity. Mount at `/api/analytics` in app.ts.
- files:
    - src/routes/analytics.ts (NEW)
    - src/app.ts (MODIFY)
- tests:
    - test/analytics.test.ts
- verify: bun test test/analytics.test.ts

### 3.2 Analytics tests
- intent: Create `test/analytics.test.ts` with integration tests. Setup: register an admin user (manually UPDATE role to 'admin' in beforeAll), register 2 regular users, create 5 posts across users with different created_at dates (use SQL INSERT with explicit timestamps). Tests: (a) overview returns correct counts, (b) top-authors returns authors sorted by post count, (c) activity returns daily breakdown with correct counts including zero-activity days, (d) non-admin user gets 403 on all analytics endpoints, (e) unauthenticated request gets 401.
- files:
    - test/analytics.test.ts (NEW)
- tests:
    - test/analytics.test.ts
- verify: bun test test/analytics.test.ts

### 3.3 Verify full regression suite
- intent: Run `bun test` to verify ALL test files pass (users, posts, auth, search, pagination, analytics). If any test fails, read the failing test file and the source it tests, diagnose the issue, and fix it. Do not skip or delete failing tests — fix the underlying code or test assertion. Every test file must pass before marking this item complete.
- files:
    - test/users.test.ts (MODIFY)
    - test/posts.test.ts (MODIFY)
    - test/auth.test.ts (MODIFY)
    - test/analytics.test.ts (MODIFY)
- tests:
    - test/users.test.ts
    - test/posts.test.ts
    - test/auth.test.ts
    - test/analytics.test.ts
- verify: bun test
