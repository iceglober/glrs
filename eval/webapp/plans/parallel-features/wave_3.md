# Wave 3 — Wire Routers

### 3.1 Mount all three new routers in app.ts
- intent: Import the comments, tags, and bookmarks routers and mount them in the Express app. Add `import commentsRouter from "./routes/comments.js"` and mount at `/api/posts`, add `import tagsRouter from "./routes/tags.js"` and mount at `/api`, add `import bookmarksRouter from "./routes/bookmarks.js"` and mount at `/api/bookmarks`. Ensure existing routes still work.
- files:
    - src/app.ts (MODIFY)
- tests:
    - test/comments.test.ts
    - test/tags.test.ts
    - test/bookmarks.test.ts
- verify: bun test
