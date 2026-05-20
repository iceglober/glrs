# Auth + Search + Analytics

## Goal

Add authentication (JWT + bcrypt), full-text search (Postgres tsvector), cursor-based pagination, and an analytics/reporting API to the existing Express + PostgreSQL app that already has users and posts CRUD.

## Constraints

- No new npm dependencies beyond what's already installed (express, pg). Use Node.js built-in `crypto` for JWT-like tokens (HMAC-SHA256 signed JSON) and password hashing (scrypt). Do NOT use jsonwebtoken or bcrypt packages.
- All new endpoints must have integration tests
- Existing 13 tests (users + posts) must continue to pass
- Postgres features only — no external search services
- Cursor-based pagination uses opaque base64-encoded cursors, not page numbers
- Auth tokens are passed via `Authorization: Bearer <token>` header
- The analytics endpoints must use raw SQL with CTEs — no ORM

## Phases
- [ ] wave_0.md - Auth: schema migration, register, login, token verification middleware
- [ ] wave_1.md - Auth: protect all existing endpoints, role-based access
- [ ] wave_2.md - Search: tsvector migration, search endpoint, cursor pagination
- [ ] wave_3.md - Analytics: reporting endpoints with complex aggregates
