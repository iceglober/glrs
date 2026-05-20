# Wave 0 — Database Migration and API Endpoints

### 0.1 Create posts migration
- intent: Add a SQL migration that creates the `posts` table with columns: `id SERIAL PRIMARY KEY`, `title TEXT NOT NULL`, `body TEXT NOT NULL`, `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `created_at TIMESTAMPTZ DEFAULT NOW()`.
- files:
    - migrations/002_create_posts.sql (NEW)
- tests:
    - Manually verify via `bun run src/migrate.ts`
- verify: bun run src/migrate.ts

### 0.2 Create posts router with CRUD endpoints
- intent: Create an Express router at `src/routes/posts.ts` with five endpoints: `GET /api/posts` (list all, ordered by created_at DESC), `GET /api/posts/:id` (get by id, 404 if not found), `POST /api/posts` (create — require title, body, user_id; validate user_id exists; return 201), `PUT /api/posts/:id` (update title and/or body), `DELETE /api/posts/:id` (delete, 204 on success). Follow the same patterns as `src/routes/users.ts`.
- files:
    - src/routes/posts.ts (NEW)
- tests:
    - test/posts.test.ts
- verify: bun test test/posts.test.ts

### 0.3 Mount posts router in app
- intent: Import the posts router in `src/app.ts` and mount it at `/api/posts`. Keep the existing users router unchanged.
- files:
    - src/app.ts (MODIFY)
- tests:
    - test/posts.test.ts
- verify: bun test test/posts.test.ts
