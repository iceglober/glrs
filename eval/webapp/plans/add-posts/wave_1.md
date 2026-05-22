# Wave 1 — Tests and Frontend

### 1.1 Integration tests for posts API
- intent: Create `test/posts.test.ts` with integration tests for all five posts endpoints. Tests should: create a user first (posts need a valid user_id), then test POST (create post), GET list, GET by id, GET 404 for nonexistent post, PUT update, DELETE. Also test that creating a post with a nonexistent user_id returns an appropriate error. Use the same patterns as `test/users.test.ts` — same port, beforeEach truncation, beforeAll migration.
- files:
    - test/posts.test.ts (NEW)
- tests:
    - test/posts.test.ts
- verify: bun test test/posts.test.ts

### 1.2 Update frontend to show posts
- intent: Update `public/index.html` to add a posts section below the users section. Show a list of posts (title, body, author name). Add a form to create a new post (select user from dropdown, title input, body textarea). Use the same vanilla JS fetch pattern as the existing users UI.
- files:
    - public/index.html (MODIFY)
- tests:
    - Manual visual check
- verify: curl -s http://localhost:3456/ | grep -q "posts"

### [x] 1.3 Verify no regressions in existing tests
- intent: Ensure that the existing users tests still pass after all changes. The posts migration and router must not break any existing functionality.
- files: []
- tests:
    - test/users.test.ts
- verify: bun test test/users.test.ts
