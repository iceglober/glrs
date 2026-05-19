import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = Router();

analyticsRouter.get("/overview", requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { rows } = await pool.query(`
    WITH user_post_counts AS (
      SELECT u.id, COUNT(p.id) AS post_count
      FROM users u
      LEFT JOIN posts p ON p.user_id = u.id
      GROUP BY u.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(*)::int FROM posts) AS total_posts,
      (SELECT COUNT(*)::int FROM posts WHERE created_at >= NOW() - INTERVAL '7 days') AS posts_last_7_days,
      (SELECT COUNT(*)::int FROM posts WHERE created_at >= NOW() - INTERVAL '30 days') AS posts_last_30_days,
      COALESCE(AVG(post_count), 0)::float AS avg_posts_per_user
    FROM user_post_counts
  `);
  res.json(rows[0]);
});

analyticsRouter.get("/top-authors", requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
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
    )
    SELECT * FROM author_stats ORDER BY post_count DESC LIMIT $1`,
    [limit],
  );
  res.json(rows);
});

analyticsRouter.get("/activity", requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 7), 365);
  const { rows } = await pool.query(
    `WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')::date,
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS date
    ),
    daily_users AS (
      SELECT DATE(created_at) AS date, COUNT(*)::int AS cnt
      FROM users
      WHERE created_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
      GROUP BY DATE(created_at)
    ),
    daily_posts AS (
      SELECT DATE(created_at) AS date, COUNT(*)::int AS cnt
      FROM posts
      WHERE created_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
      GROUP BY DATE(created_at)
    )
    SELECT
      ds.date::text AS date,
      COALESCE(du.cnt, 0)::int AS new_users,
      COALESCE(dp.cnt, 0)::int AS new_posts
    FROM date_series ds
    LEFT JOIN daily_users du ON du.date = ds.date
    LEFT JOIN daily_posts dp ON dp.date = ds.date
    ORDER BY ds.date ASC`,
    [days],
  );
  res.json(rows);
});
