import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";

export const analyticsRouter = Router();

analyticsRouter.get("/overview", requireAdmin, async (_req: Request, res: Response) => {
  const { rows } = await pool.query(`
    WITH totals AS (
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
      (total_posts::float8 / NULLIF(total_users, 0)) AS avg_posts_per_user
    FROM totals
  `);
  res.json(rows[0]);
});

analyticsRouter.get("/top-authors", requireAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);
  const { rows } = await pool.query(
    `SELECT
       u.id AS user_id,
       u.name,
       u.email,
       COUNT(p.id)::int AS post_count,
       MAX(p.created_at) AS latest_post_at
     FROM users u
     LEFT JOIN posts p ON p.user_id = u.id
     GROUP BY u.id, u.name, u.email
     ORDER BY post_count DESC
     LIMIT $1`,
    [limit],
  );
  res.json(rows);
});

analyticsRouter.get("/activity", requireAdmin, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 30), 365);
  const { rows } = await pool.query(
    `SELECT
       gs.day::date AS date,
       COUNT(DISTINCT u.id)::int AS new_users,
       COUNT(DISTINCT p.id)::int AS new_posts
     FROM generate_series(
       (CURRENT_DATE - ($1::int - 1))::timestamptz,
       CURRENT_DATE::timestamptz,
       INTERVAL '1 day'
     ) AS gs(day)
     LEFT JOIN users u ON u.created_at::date = gs.day::date
     LEFT JOIN posts p ON p.created_at::date = gs.day::date
     GROUP BY gs.day::date
     ORDER BY gs.day::date ASC`,
    [days],
  );
  res.json(rows);
});
