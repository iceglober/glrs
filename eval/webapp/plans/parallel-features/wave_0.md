# Wave 0 — Comments System

### 0.1 Comments migration, CRUD routes, and tests
- intent: Add a comments system for posts. (a) Create `migrations/005_create_comments.sql` with a `comments` table: `id SERIAL PRIMARY KEY, post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()`. Add index on `post_id`. (b) Create `src/routes/comments.ts` with: `GET /api/posts/:postId/comments` returning all comments for a post with author name (join users), `POST /api/posts/:postId/comments` accepting `{body}` and creating a comment for the authenticated user (requireAuth), returning 201 with the created comment, `DELETE /api/posts/:postId/comments/:id` allowing only the comment author or admin to delete (requireAuth), returning 204 on success, 403 if not author/admin, 404 if not found. Do NOT mount the router in app.ts — wave_3 handles wiring. Export the router as default. (c) Create `test/comments.test.ts` on port 3464 that imports and mounts the comments router directly for testing. Tests: create comment on post, list comments for post, delete own comment, reject delete by non-author, reject unauthenticated access.
- files:
    - migrations/005_create_comments.sql (NEW)
    - src/routes/comments.ts (NEW)
    - test/comments.test.ts (NEW)
- tests:
    - test/comments.test.ts
- verify: bun run src/migrate.ts && bun test test/comments.test.ts
