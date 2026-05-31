import { type Request, type Response, type NextFunction } from "express";
import { verifyToken } from "../auth.js";
import { pool } from "../db.js";

export const rateLimitConfig = {
  get readMax() { return parseInt(process.env.RATE_LIMIT_READ_MAX ?? "1000", 10); },
  get writeMax() { return parseInt(process.env.RATE_LIMIT_WRITE_MAX ?? "100", 10); },
  get windowSeconds() { return parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10); },
};

export async function rateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Parse Authorization header
  const authHeader = req.headers.authorization;
  let userId: number | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      userId = payload.userId;

      // Look up role from DB
      const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
      if (rows.length > 0 && rows[0].role === "admin") {
        // Admin bypasses rate limiting entirely — no count, no insert
        next();
        return;
      }
    }
  }

  const key = userId !== null ? `user:${userId}` : `ip:${req.ip}`;
  const category = req.method === "GET" ? "read" : "write";
  const max = category === "read" ? rateLimitConfig.readMax : rateLimitConfig.writeMax;

  // Single query: count recent requests and get oldest timestamp
  const { rows } = await pool.query<{ count: number; oldest: string | null }>(
    `SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest
     FROM rate_limit_requests
     WHERE key = $1
       AND category = $2
       AND created_at > NOW() - make_interval(secs => $3)`,
    [key, category, rateLimitConfig.windowSeconds],
  );

  const count = rows[0].count;
  const oldest = rows[0].oldest;

  if (count >= max) {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        rateLimitConfig.windowSeconds -
          (Date.now() / 1000 - new Date(oldest!).getTime() / 1000),
      ),
    );
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Rate limit exceeded", retryAfter });
    return;
  }

  // Insert a new request record and proceed
  await pool.query(
    "INSERT INTO rate_limit_requests (key, category) VALUES ($1, $2)",
    [key, category],
  );
  next();
}
