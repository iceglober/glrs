import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";

export const analyticsRouter = Router();

// GET /api/analytics/overview — admin-only summary stats
analyticsRouter.get("/overview", requireAdmin, async (req: Request, res: Response) => {
  const { rows } = await pool.query(`
    WITH stats AS (
      SELECT
        (SELECT COUNT(*) FROM users)::int AS total_users,
        (SELECT COUNT(*) FROM posts)::int AS total_posts,
        (SELECT COUNT(*) FROM posts WHERE created_at >= NOW() - INTERVAL '7 days')::int AS posts_last_7_days,
        (SELECT COUNT(*) FROM posts WHERE created_at >= NOW() - INTERVAL '30 days')::int AS posts_last_30_days
    )
    SELECT
      total_users,
      total_posts,
      posts_last_7_days,
      posts_last_30_days,
      CASE
        WHEN total_users > 0 THEN (total_posts::float / total_users)
        ELSE 0::float
      END AS avg_posts_per_user
    FROM stats
  `);
  res.json(rows[0]);
});

// GET /api/analytics/top-authors — admin-only top post authors
analyticsRouter.get("/top-authors", requireAdmin, async (req: Request, res: Response) => {
  const { rows } = await pool.query(`
    SELECT
      u.id AS user_id,
      u.name,
      u.email,
      COUNT(p.id)::int AS post_count,
      MAX(p.created_at) AS latest_post_at
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id
    GROUP BY u.id, u.name, u.email
    ORDER BY post_count DESC
  `);
  res.json(rows);
});

// GET /api/analytics/activity — admin-only daily activity report
analyticsRouter.get("/activity", requireAdmin, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 7), 365);
  const { rows } = await pool.query(`
    WITH date_range AS (
      SELECT generate_series(
        (NOW() - INTERVAL '1 day' * $1)::date,
        NOW()::date,
        INTERVAL '1 day'
      ) AS date
    ),
    user_counts AS (
      SELECT DATE(created_at) AS date, COUNT(*)::int AS new_users
      FROM users
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(created_at)
    ),
    post_counts AS (
      SELECT DATE(created_at) AS date, COUNT(*)::int AS new_posts
      FROM posts
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(created_at)
    )
    SELECT
      dr.date,
      COALESCE(uc.new_users, 0)::int AS new_users,
      COALESCE(pc.new_posts, 0)::int AS new_posts
    FROM date_range dr
    LEFT JOIN user_counts uc ON dr.date = uc.date
    LEFT JOIN post_counts pc ON dr.date = pc.date
    ORDER BY dr.date ASC
  `, [days]);
  res.json(rows);
});
