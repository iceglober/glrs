# Wave 1 — Tags System

### 1.1 Tags migration, CRUD routes, and tests
- intent: Add a tagging system for posts using a many-to-many relationship. (a) Create `migrations/006_create_tags.sql` with two tables: `tags` table with `id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()`, and `post_tags` junction table with `post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (post_id, tag_id)`. (b) Create `src/routes/tags.ts` with: `GET /api/tags` returning all tags with post count (LEFT JOIN post_tags, GROUP BY), `POST /api/tags` accepting `{name}` and creating a tag (requireAuth), returning 201, rejecting duplicate name (409), `POST /api/posts/:postId/tags` accepting `{tagId}` and tagging a post (requireAuth), returning 201, `DELETE /api/posts/:postId/tags/:tagId` removing a tag from a post (requireAuth), returning 204, `GET /api/posts/:postId/tags` returning all tags for a post. Do NOT mount the router in app.ts — wave_3 handles wiring. Export the router as default. (c) Create `test/tags.test.ts` on port 3465 that imports and mounts the tags router directly for testing. Tests: create tag, list tags with counts, tag a post, list tags for post, remove tag from post, reject duplicate tag name.
- files:
    - migrations/006_create_tags.sql (NEW)
    - src/routes/tags.ts (NEW)
    - test/tags.test.ts (NEW)
- tests:
    - test/tags.test.ts
- verify: bun run src/migrate.ts && bun test test/tags.test.ts
