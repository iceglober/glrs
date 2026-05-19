import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// GET /api/analytics/overview — aggregate stats
analyticsRouter.get("/overview", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const { rows } = await pool.query(`
    WITH
      user_stats AS (
        SELECT COUNT(*)::int AS total_users FROM users
      ),
      post_stats AS (
        SELECT
          COUNT(*)::int AS total_posts,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS posts_last_7_days,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS posts_last_30_days
        FROM posts
      )
    SELECT
      u.total_users,
      p.total_posts,
      p.posts_last_7_days,
      p.posts_last_30_days,
      CASE WHEN u.total_users > 0
        THEN ROUND(p.total_posts::numeric / u.total_users, 2)::float8
        ELSE 0::float8
      END AS avg_posts_per_user
    FROM user_stats u, post_stats p
  `);
  res.json(rows[0]);
});

// GET /api/analytics/top-authors?limit=N — top posters sorted by count
analyticsRouter.get("/top-authors", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);
  const { rows } = await pool.query(`
    WITH author_stats AS (
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        COUNT(p.id)::int AS post_count,
        MAX(p.created_at) AS latest_post_at
      FROM users u
      LEFT JOIN posts p ON p.user_id = u.id
      GROUP BY u.id, u.name, u.email
    )
    SELECT * FROM author_stats
    ORDER BY post_count DESC
    LIMIT $1
  `, [limit]);
  res.json(rows);
});

// GET /api/analytics/activity?days=N — daily counts with gap-filling
analyticsRouter.get("/activity", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 30), 365);
  const { rows } = await pool.query(`
    WITH date_series AS (
      SELECT generate_series(
        CURRENT_DATE - ($1 - 1) * INTERVAL '1 day',
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS date
    ),
    user_activity AS (
      SELECT created_at::date AS date, COUNT(*)::int AS new_users
      FROM users
      WHERE created_at::date >= CURRENT_DATE - ($1 - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    ),
    post_activity AS (
      SELECT created_at::date AS date, COUNT(*)::int AS new_posts
      FROM posts
      WHERE created_at::date >= CURRENT_DATE - ($1 - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    )
    SELECT
      ds.date::text AS date,
      COALESCE(ua.new_users, 0)::int AS new_users,
      COALESCE(pa.new_posts, 0)::int AS new_posts
    FROM date_series ds
    LEFT JOIN user_activity ua ON ua.date = ds.date
    LEFT JOIN post_activity pa ON pa.date = ds.date
    ORDER BY ds.date
  `, [days]);
  res.json(rows);
});
