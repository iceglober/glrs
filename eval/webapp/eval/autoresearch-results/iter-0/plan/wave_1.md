# Wave 1 — Auth Middleware and Route Protection

### 1.1 Auth middleware
- intent: Create `src/middleware/auth.ts` exporting two middlewares: (a) `requireAuth` — reads `Authorization: Bearer <token>` header, calls `verifyToken`, attaches `req.user = {userId, role}` to the request. Returns 401 `{error: "Authentication required"}` if no token or invalid token. (b) `requireAdmin` — calls `requireAuth` first, then checks `req.user.role === 'admin'`. Returns 403 `{error: "Admin access required"}` if not admin. Extend Express Request type via declaration merging to include `user?: {userId: number, role: string}`.
- files:
    - src/middleware/auth.ts (NEW)
- tests:
    - test/auth-middleware.test.ts
- verify: bun test test/auth-middleware.test.ts

### 1.2 Protect mutation endpoints
- intent: Apply `requireAuth` middleware to all POST, PUT, DELETE endpoints on both users and posts routers. GET endpoints remain public (no auth required). For posts creation (`POST /api/posts`), automatically set `user_id` from the authenticated user's token (`req.user.userId`) instead of requiring it in the request body — the user can only create posts as themselves. For user deletion (`DELETE /api/users/:id`), only allow if the authenticated user is deleting themselves OR is an admin. Return 403 otherwise.
- files:
    - src/routes/users.ts (MODIFY)
    - src/routes/posts.ts (MODIFY)
- tests:
    - test/auth-protected.test.ts
- verify: bun test test/auth-protected.test.ts

### 1.3 Update existing tests for auth
- intent: The existing `test/users.test.ts` and `test/posts.test.ts` will break because POST/PUT/DELETE now require auth. Update both test files to: (a) register a test user via `POST /api/auth/register` in `beforeAll`, (b) include the returned token in all mutation requests via `Authorization: Bearer <token>` header. GET requests should still work without auth. All 13 existing tests must continue to pass with the auth headers added.
- files:
    - test/users.test.ts (MODIFY)
    - test/posts.test.ts (MODIFY)
- tests:
    - test/users.test.ts
    - test/posts.test.ts
- verify: bun test test/users.test.ts && bun test test/posts.test.ts
