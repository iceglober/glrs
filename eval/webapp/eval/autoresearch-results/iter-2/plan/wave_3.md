# Wave 3 — Analytics, Reporting, and Final Regression

### 3.1 Analytics endpoints, tests, and full regression verification
- intent: (a) Create `src/routes/analytics.ts` with three reporting endpoints (all require admin auth via `requireAdmin`): `GET /api/analytics/overview` returns `{total_users, total_posts, posts_last_7_days, posts_last_30_days, avg_posts_per_user}` using a single CTE-based SQL query. `GET /api/analytics/top-authors?limit=N` returns array of `{user_id, name, email, post_count, latest_post_at}` ordered by post_count DESC, default limit 10, using JOIN + GROUP BY. `GET /api/analytics/activity?days=N` returns daily breakdown `{date, new_users, new_posts}` for the last N days (default 30), using `generate_series` to include zero-activity days. Mount at `/api/analytics` in app.ts. (b) Create `test/analytics.test.ts` with integration tests: register an admin user (UPDATE role to 'admin'), register 2 regular users, create posts. Test overview returns correct counts, top-authors sorted, activity has correct daily breakdown, non-admin gets 403, unauthenticated gets 401. (c) Run `bun test` to verify ALL test files pass. If any test fails, diagnose and fix the underlying code or test assertion.
- files:
    - src/routes/analytics.ts (NEW)
    - src/app.ts (MODIFY)
    - test/analytics.test.ts (NEW)
    - test/users.test.ts (MODIFY)
    - test/posts.test.ts (MODIFY)
    - test/auth.test.ts (MODIFY)
- tests:
    - test/analytics.test.ts
    - test/users.test.ts
    - test/posts.test.ts
    - test/auth.test.ts
- verify: bun test
