import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = Router();

// GET /api/analytics/overview — aggregate counts
analyticsRouter.get("/overview", requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { rows } = await pool.query(`
    WITH user_stats AS (
      SELECT COUNT(*) AS total_users FROM users
    ),
    post_stats AS (
      SELECT
        COUNT(*) AS total_posts,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS posts_last_7_days,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS posts_last_30_days
      FROM posts
    ),
    avg_cte AS (
      SELECT
        CASE WHEN us.total_users::bigint > 0
          THEN ps.total_posts::numeric / us.total_users::bigint
          ELSE 0
        END AS avg_posts_per_user
      FROM user_stats us, post_stats ps
    )
    SELECT
      us.total_users,
      ps.total_posts,
      ps.posts_last_7_days,
      ps.posts_last_30_days,
      ac.avg_posts_per_user
    FROM user_stats us, post_stats ps, avg_cte ac
  `);

  const row = rows[0];
  res.json({
    total_users: Number(row.total_users),
    total_posts: Number(row.total_posts),
    posts_last_7_days: Number(row.posts_last_7_days),
    posts_last_30_days: Number(row.posts_last_30_days),
    avg_posts_per_user: Number(row.avg_posts_per_user),
  });
});

// GET /api/analytics/top-authors — ranked by post count
analyticsRouter.get("/top-authors", requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { rows } = await pool.query(`
    WITH author_stats AS (
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        COUNT(p.id) AS post_count,
        MAX(p.created_at) AS latest_post_at
      FROM users u
      LEFT JOIN posts p ON p.user_id = u.id
      GROUP BY u.id, u.name, u.email
    )
    SELECT user_id, name, email, post_count, latest_post_at
    FROM author_stats
    ORDER BY post_count DESC
  `);

  res.json(rows.map((r) => ({
    user_id: Number(r.user_id),
    name: r.name,
    email: r.email,
    post_count: Number(r.post_count),
    latest_post_at: r.latest_post_at,
  })));
});

// GET /api/analytics/activity?days=N — daily breakdown with zero-fill
analyticsRouter.get("/activity", requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const days = Math.max(1, parseInt(req.query.days as string) || 7);

  const { rows } = await pool.query(`
    WITH date_series AS (
      SELECT generate_series(
        CURRENT_DATE::timestamptz - ($1::int - 1) * INTERVAL '1 day',
        CURRENT_DATE::timestamptz,
        INTERVAL '1 day'
      )::date AS date
    ),
    user_counts AS (
      SELECT created_at::date AS date, COUNT(*) AS new_users
      FROM users
      WHERE created_at >= CURRENT_DATE::timestamptz - ($1::int - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    ),
    post_counts AS (
      SELECT created_at::date AS date, COUNT(*) AS new_posts
      FROM posts
      WHERE created_at >= CURRENT_DATE::timestamptz - ($1::int - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    )
    SELECT
      ds.date,
      COALESCE(uc.new_users, 0) AS new_users,
      COALESCE(pc.new_posts, 0) AS new_posts
    FROM date_series ds
    LEFT JOIN user_counts uc ON uc.date = ds.date
    LEFT JOIN post_counts pc ON pc.date = ds.date
    ORDER BY ds.date
  `, [days]);

  res.json(rows.map((r) => ({
    date: r.date,
    new_users: Number(r.new_users),
    new_posts: Number(r.new_posts),
  })));
});
