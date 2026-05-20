# Wave 0 — Auth Foundation

### 0.1 Auth schema, token utilities, and register/login endpoints
- intent: Implement the full auth foundation in one pass. (a) Create `migrations/003_auth.sql` that adds `password_hash TEXT` and `role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin'))` columns to the `users` table, and creates a `sessions` table with `id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()`. Run `bun run src/migrate.ts` to apply. (b) Create `src/auth.ts` with: `hashPassword(password)` using Node.js `crypto.scrypt` with random salt returning `salt:hash` format, `verifyPassword(password, stored)` that splits and verifies, `generateToken(userId)` that creates a JSON payload `{userId, exp: now+24h}` signed with HMAC-SHA256 using `process.env.AUTH_SECRET` (default: 'dev-secret') returning base64url-encoded `payload.signature`, `verifyToken(token)` that validates signature and expiration returning `{userId}` or null. (c) Create `src/routes/auth.ts` with: `POST /api/auth/register` accepting `{name, email, password}`, hashing password, inserting user, returning `{user: {id, name, email, role}, token}` with status 201, rejecting duplicate email (409) and password shorter than 8 chars (400). `POST /api/auth/login` accepting `{email, password}`, verifying credentials, inserting session, returning `{user: {id, name, email, role}, token}`, returning 401 for wrong credentials. Mount at `/api/auth` in app.ts.
- files:
    - migrations/003_auth.sql (NEW)
    - src/auth.ts (NEW)
    - src/routes/auth.ts (NEW)
    - src/app.ts (MODIFY)
- tests:
    - test/auth.test.ts
- verify: bun run src/migrate.ts && bun test test/auth.test.ts
