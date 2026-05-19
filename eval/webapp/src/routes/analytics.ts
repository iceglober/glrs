import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";

export const analyticsRouter = Router();

analyticsRouter.get("/overview", requireAdmin, async (_req: Request, res: Response) => {
  const { rows } = await pool.query(`
    WITH
      user_count  AS (SELECT COUNT(*)::int AS n FROM users),
      post_count  AS (SELECT COUNT(*)::int AS n FROM posts),
      posts_7d    AS (SELECT COUNT(*)::int AS n FROM posts WHERE created_at >= NOW() - INTERVAL '7 days'),
      posts_30d   AS (SELECT COUNT(*)::int AS n FROM posts WHERE created_at >= NOW() - INTERVAL '30 days')
    SELECT
      (SELECT n FROM user_count)                                                 AS total_users,
      (SELECT n FROM post_count)                                                 AS total_posts,
      (SELECT n FROM posts_7d)                                                   AS posts_last_7_days,
      (SELECT n FROM posts_30d)                                                  AS posts_last_30_days,
      (SELECT n FROM post_count)::float / NULLIF((SELECT n FROM user_count), 0) AS avg_posts_per_user
  `);
  const row = rows[0];
  res.json({
    total_users: row.total_users,
    total_posts: row.total_posts,
    posts_last_7_days: row.posts_last_7_days,
    posts_last_30_days: row.posts_last_30_days,
    avg_posts_per_user: row.avg_posts_per_user,
  });
});

analyticsRouter.get("/top-authors", requireAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.email,
            COUNT(p.id)::int AS post_count,
            MAX(p.created_at) AS latest_post_at
     FROM users u
     LEFT JOIN posts p ON p.user_id = u.id
     GROUP BY u.id, u.name, u.email
     ORDER BY post_count DESC, u.id ASC
     LIMIT $1`,
    [limit],
  );
  res.json(rows);
});

analyticsRouter.get("/activity", requireAdmin, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 30), 365);
  const { rows } = await pool.query(
    `SELECT
       d.day::date AS date,
       COALESCE(u.new_users, 0)::int AS new_users,
       COALESCE(p.new_posts, 0)::int AS new_posts
     FROM generate_series(
       CURRENT_DATE - ($1::int - 1),
       CURRENT_DATE,
       INTERVAL '1 day'
     ) AS d(day)
     LEFT JOIN (
       SELECT DATE(created_at) AS day, COUNT(*)::int AS new_users
       FROM users
       WHERE created_at::date >= CURRENT_DATE - ($1::int - 1)
       GROUP BY DATE(created_at)
     ) u ON u.day = d.day::date
     LEFT JOIN (
       SELECT DATE(created_at) AS day, COUNT(*)::int AS new_posts
       FROM posts
       WHERE created_at::date >= CURRENT_DATE - ($1::int - 1)
       GROUP BY DATE(created_at)
     ) p ON p.day = d.day::date
     ORDER BY d.day ASC`,
    [days],
  );
  res.json(rows);
});
