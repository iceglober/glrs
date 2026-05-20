# Wave 2 — Full-Text Search and Cursor Pagination

### 2.1 Search migration, search endpoint, and cursor-based pagination
- intent: Implement search and pagination in one pass. (a) Create `migrations/004_search.sql` that adds a `search_vector TSVECTOR` column to posts, creates a GIN index on it, creates a trigger function that updates `search_vector` from `to_tsvector('english', title || ' ' || body)` on INSERT and UPDATE, and backfills existing rows. Run `bun run src/migrate.ts`. (b) Add `GET /api/posts/search?q=<query>` endpoint to the posts router. Use `to_tsquery('english', <query>)` to search against `search_vector`, order by `ts_rank`, include a `headline` field from `ts_headline`. Return empty array for no matches, return 400 if `q` is missing. (c) Add cursor-based pagination to `GET /api/posts` and `GET /api/users`. Accept optional query params `?limit=N&cursor=<opaque>`. The cursor is a base64url-encoded JSON `{id: number, created_at: string}`. Response format: `{data: [...], next_cursor: "..." | null, has_more: boolean}`. Default limit is 10, max limit is 100. When no cursor is provided, start from the most recent. The existing behavior (return bare array) must change to the new envelope format. IMPORTANT: Also update `test/users.test.ts` and `test/posts.test.ts` to handle the new envelope format — any assertion that expects a bare array from GET /api/users or GET /api/posts must unwrap `response.body.data` instead. Run `bun test` (all tests) to verify nothing is broken.
- files:
    - migrations/004_search.sql (NEW)
    - src/routes/posts.ts (MODIFY)
    - src/routes/users.ts (MODIFY)
    - test/users.test.ts (MODIFY)
    - test/posts.test.ts (MODIFY)
- tests:
    - test/search.test.ts
    - test/pagination.test.ts
    - test/users.test.ts
    - test/posts.test.ts
- verify: bun test
