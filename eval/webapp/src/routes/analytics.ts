import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = Router();

/**
 * Admin-only guard: requires authentication + role === 'admin'.
 */
function requireAdmin(req: Request, res: Response): boolean {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /api/analytics/overview — aggregate counts
analyticsRouter.get("/overview", requireAuth, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const { rows } = await pool.query(`
    WITH stats AS (
      SELECT
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM posts) AS total_posts,
        (SELECT COUNT(*)::int FROM posts WHERE created_at >= NOW() - INTERVAL '7 days') AS posts_last_7_days,
        (SELECT COUNT(*)::int FROM posts WHERE created_at >= NOW() - INTERVAL '30 days') AS posts_last_30_days
    )
    SELECT
      stats.*,
      CASE WHEN stats.total_users = 0 THEN 0
           ELSE ROUND(stats.total_posts::numeric / stats.total_users, 2)::float
      END::float AS avg_posts_per_user
    FROM stats
  `);

  res.json(rows[0]);
});

// GET /api/analytics/top-authors?limit=N — authors ranked by post count
analyticsRouter.get("/top-authors", requireAuth, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);

  const { rows } = await pool.query(
    `WITH author_stats AS (
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        COUNT(p.id)::int AS post_count,
        MAX(p.created_at) AS latest_post_at
      FROM users u
      LEFT JOIN posts p ON p.user_id = u.id
      GROUP BY u.id, u.name, u.email
      HAVING COUNT(p.id) > 0
    )
    SELECT * FROM author_stats
    ORDER BY post_count DESC, user_id ASC
    LIMIT $1`,
    [limit],
  );

  res.json(rows);
});

// GET /api/analytics/activity?days=N — daily new_users and new_posts (zero-filled)
analyticsRouter.get("/activity", requireAuth, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 30), 365);

  const { rows } = await pool.query(
    `WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')::date,
        CURRENT_DATE,
        '1 day'::interval
      )::date AS date
    ),
    daily_users AS (
      SELECT created_at::date AS date, COUNT(*)::int AS new_users
      FROM users
      WHERE created_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    ),
    daily_posts AS (
      SELECT created_at::date AS date, COUNT(*)::int AS new_posts
      FROM posts
      WHERE created_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    )
    SELECT
      ds.date::text AS date,
      COALESCE(du.new_users, 0)::int AS new_users,
      COALESCE(dp.new_posts, 0)::int AS new_posts
    FROM date_series ds
    LEFT JOIN daily_users du ON du.date = ds.date
    LEFT JOIN daily_posts dp ON dp.date = ds.date
    ORDER BY ds.date ASC`,
    [days],
  );

  res.json(rows);
});
