import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";

export const analyticsRouter = Router();

// GET /overview - returns platform statistics
analyticsRouter.get("/overview", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(`
    WITH stats AS (
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM posts) AS total_posts,
        (SELECT COUNT(*) FROM posts WHERE created_at >= NOW() - INTERVAL '7 days') AS posts_last_7_days,
        (SELECT COUNT(*) FROM posts WHERE created_at >= NOW() - INTERVAL '30 days') AS posts_last_30_days,
        (SELECT ROUND(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM users), 0), 2) FROM posts) AS avg_posts_per_user
    )
    SELECT * FROM stats
  `);

  const stats = rows[0];
  res.json({
    total_users: Number(stats.total_users),
    total_posts: Number(stats.total_posts),
    posts_last_7_days: Number(stats.posts_last_7_days),
    posts_last_30_days: Number(stats.posts_last_30_days),
    avg_posts_per_user: Number(stats.avg_posts_per_user),
  });
});

// GET /top-authors - returns top authors by post count
analyticsRouter.get("/top-authors", requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;

  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.email, COUNT(p.id) AS post_count, MAX(p.created_at) AS latest_post_at
     FROM users u
     LEFT JOIN posts p ON p.user_id = u.id
     GROUP BY u.id, u.name, u.email
     ORDER BY post_count DESC
     LIMIT $1`,
    [limit]
  );

  res.json(
    rows.map((row) => ({
      user_id: Number(row.user_id),
      name: row.name,
      email: row.email,
      post_count: Number(row.post_count),
      latest_post_at: row.latest_post_at,
    }))
  );
});

// GET /activity - returns daily activity breakdown
analyticsRouter.get("/activity", requireAdmin, async (req, res) => {
  const days = parseInt(req.query.days as string) || 30;

  const { rows } = await pool.query(
    `WITH date_series AS (
      SELECT generate_series(
        (NOW() - INTERVAL '1 day' * ($1 - 1))::date,
        NOW()::date,
        '1 day'::interval
      )::date AS date
    ),
    user_counts AS (
      SELECT created_at::date AS date, COUNT(*) AS new_users
      FROM users
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY created_at::date
    ),
    post_counts AS (
      SELECT created_at::date AS date, COUNT(*) AS new_posts
      FROM posts
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY created_at::date
    )
    SELECT
      ds.date,
      COALESCE(uc.new_users, 0) AS new_users,
      COALESCE(pc.new_posts, 0) AS new_posts
    FROM date_series ds
    LEFT JOIN user_counts uc ON uc.date = ds.date
    LEFT JOIN post_counts pc ON pc.date = ds.date
    ORDER BY ds.date ASC`,
    [days]
  );

  res.json(
    rows.map((row) => ({
      date: row.date.toISOString().split("T")[0],
      new_users: Number(row.new_users),
      new_posts: Number(row.new_posts),
    }))
  );
});
