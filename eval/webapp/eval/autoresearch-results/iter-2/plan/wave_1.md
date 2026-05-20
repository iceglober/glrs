# Wave 1 — Auth Middleware and Route Protection

### 1.1 Auth middleware, protect endpoints, and update existing tests
- intent: (a) Create `src/middleware/auth.ts` exporting two middlewares: `requireAuth` reads `Authorization: Bearer <token>` header, calls `verifyToken`, attaches `req.user = {userId, role}` to the request, returns 401 `{error: "Authentication required"}` if no token or invalid token. `requireAdmin` calls `requireAuth` first, then checks `req.user.role === 'admin'`, returns 403 `{error: "Admin access required"}` if not admin. Extend Express Request type via declaration merging to include `user?: {userId: number, role: string}`. (b) Apply `requireAuth` middleware to all POST, PUT, DELETE endpoints on both users and posts routers. GET endpoints remain public. For `POST /api/posts`, automatically set `user_id` from `req.user.userId` instead of requiring it in the body. For `DELETE /api/users/:id`, only allow if the authenticated user is deleting themselves OR is an admin, return 403 otherwise. (c) Update `test/users.test.ts` and `test/posts.test.ts`: register a test user via `POST /api/auth/register` in `beforeAll`, include the returned token in all mutation requests via `Authorization: Bearer <token>` header. GET requests should still work without auth. All 13 existing tests must continue to pass.
- files:
    - src/middleware/auth.ts (NEW)
    - src/routes/users.ts (MODIFY)
    - src/routes/posts.ts (MODIFY)
    - test/users.test.ts (MODIFY)
    - test/posts.test.ts (MODIFY)
- tests:
    - test/users.test.ts
    - test/posts.test.ts
- verify: bun test test/users.test.ts && bun test test/posts.test.ts
