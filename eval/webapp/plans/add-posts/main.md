# Add Posts Feature

## Goal

Add a "posts" resource to the existing Express + PostgreSQL app. Posts belong to users (foreign key). Full CRUD API, database migration, integration tests, and a simple UI update.

## Constraints

- Use the same patterns as the existing users feature (raw SQL via pg, Express Router, bun:test)
- Posts table must have a foreign key to users with CASCADE delete
- All new endpoints must be tested with integration tests
- Existing user tests must continue to pass
- No new dependencies — use what's already installed

## Phases
- [ ] wave_0.md - Database migration and API endpoints
- [ ] wave_1.md - Tests and frontend
