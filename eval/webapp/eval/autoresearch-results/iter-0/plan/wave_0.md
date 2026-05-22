# Wave 0 — Auth Foundation

### 0.1 Auth schema migration
- intent: Add a migration that: (a) adds `password_hash TEXT` and `role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin'))` columns to the `users` table, (b) creates a `sessions` table with `id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()`.
- files:
    - migrations/003_auth.sql (NEW)
- tests:
    - test/auth.test.ts
- verify: bun run src/migrate.ts

### 0.2 Token utilities
- intent: Create `src/auth.ts` with: (a) `hashPassword(password: string): Promise<string>` using Node.js `crypto.scrypt` with a random salt, returning `salt:hash` format, (b) `verifyPassword(password: string, stored: string): Promise<boolean>` that splits the stored value and verifies, (c) `generateToken(userId: number): string` that creates a JSON payload `{userId, exp: now+24h}` and signs it with HMAC-SHA256 using a secret from `process.env.AUTH_SECRET` (default: 'dev-secret'), returning base64url-encoded `payload.signature`, (d) `verifyToken(token: string): {userId: number} | null` that validates the signature and expiration.
- files:
    - src/auth.ts (NEW)
- tests:
    - test/auth.test.ts
- verify: bun test test/auth.test.ts

### 0.3 Register and login endpoints
- intent: Create `src/routes/auth.ts` with: (a) `POST /api/auth/register` — accepts `{name, email, password}`, hashes password, inserts user, returns `{user: {id, name, email, role}, token}` with status 201. Reject if email already exists (409). Reject if password shorter than 8 chars (400). (b) `POST /api/auth/login` — accepts `{email, password}`, verifies credentials, inserts session, returns `{user: {id, name, email, role}, token}`. Return 401 for wrong email or password. Mount at `/api/auth` in app.ts.
- files:
    - src/routes/auth.ts (NEW)
    - src/app.ts (MODIFY)
- tests:
    - test/auth.test.ts
- verify: bun test test/auth.test.ts
