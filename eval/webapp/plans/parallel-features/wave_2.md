# Wave 2 — Bookmarks System

### 2.1 Bookmarks migration, CRUD routes, and tests
- intent: Add a bookmarks system so users can save posts. (a) Create `migrations/007_create_bookmarks.sql` with a `bookmarks` table: `id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, post_id)`. Add index on `user_id`. (b) Create `src/routes/bookmarks.ts` with: `GET /api/bookmarks` returning the authenticated user's bookmarked posts with post title and author name (join posts, users) ordered by bookmark created_at DESC (requireAuth), `POST /api/bookmarks` accepting `{postId}` and creating a bookmark for the authenticated user (requireAuth), returning 201, rejecting duplicate bookmark (409), rejecting nonexistent post (404), `DELETE /api/bookmarks/:id` allowing only the bookmark owner to delete (requireAuth), returning 204, 403 if not owner, 404 if not found. Do NOT mount the router in app.ts — wave_3 handles wiring. Export the router as default. (c) Create `test/bookmarks.test.ts` on port 3466 that imports and mounts the bookmarks router directly for testing. Tests: bookmark a post, list bookmarks, delete bookmark, reject duplicate bookmark, reject bookmark of nonexistent post, reject unauthenticated access.
- files:
    - migrations/007_create_bookmarks.sql (NEW)
    - src/routes/bookmarks.ts (NEW)
    - test/bookmarks.test.ts (NEW)
- tests:
    - test/bookmarks.test.ts
- verify: bun run src/migrate.ts && bun test test/bookmarks.test.ts
