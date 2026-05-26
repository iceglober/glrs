# Parallel Features — Comments, Tags, Bookmarks

## Goal

Add three independent features to the existing Express + PostgreSQL app: a comments system on posts, a tagging system for posts, and a bookmarks system for users. Each feature is fully self-contained with its own migration, route file, and test file.

## Constraints

- No new npm dependencies — use only express and pg (already installed)
- Each feature gets its own migration, route module, and test file
- Existing tests (users, posts, auth, analytics) must continue to pass
- All endpoints require auth (Bearer token via existing middleware)
- Use the existing `requireAuth` middleware from `src/middleware/auth.ts`
- Import `pool` from `src/db.ts` for database queries

## Phases
- [ ] wave_0.md — Comments: migration, CRUD routes, tests
- [ ] wave_1.md — Tags: migration, CRUD routes, tests
- [ ] wave_2.md — Bookmarks: migration, CRUD routes, tests
- [ ] wave_3.md — Wire all three routers into app.ts

## Out of scope
- Frontend/UI changes
- Pagination on new endpoints
- Full-text search on comments or tags
