import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = Router();

// Middleware to check admin role
function requireAdmin(req: Request, res: Response, next: () => void) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// GET /api/analytics/overview — admin-only stats
analyticsRouter.get("/overview", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { rows } = await pool.query(`
    WITH user_stats AS (
      SELECT COUNT(*)::INT AS total_users FROM users
    ),
    post_stats AS (
      SELECT
        COUNT(*)::INT AS total_posts,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::INT AS posts_last_7_days,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::INT AS posts_last_30_days
      FROM posts
    ),
    avg_calc AS (
      SELECT COALESCE(AVG(post_count), 0)::NUMERIC AS avg_posts_per_user
      FROM (
        SELECT COUNT(*) AS post_count FROM posts GROUP BY user_id
      ) AS user_posts
    )
    SELECT
      us.total_users,
      ps.total_posts,
      ps.posts_last_7_days,
      ps.posts_last_30_days,
      ac.avg_posts_per_user
    FROM user_stats us, post_stats ps, avg_calc ac
  `);

  const data = rows[0] as {
    total_users: string | number;
    total_posts: string | number;
    posts_last_7_days: string | number;
    posts_last_30_days: string | number;
    avg_posts_per_user: string | number;
  };

  res.json({
    total_users: typeof data.total_users === "string" ? parseInt(data.total_users) : data.total_users,
    total_posts: typeof data.total_posts === "string" ? parseInt(data.total_posts) : data.total_posts,
    posts_last_7_days: typeof data.posts_last_7_days === "string" ? parseInt(data.posts_last_7_days) : data.posts_last_7_days,
    posts_last_30_days: typeof data.posts_last_30_days === "string" ? parseInt(data.posts_last_30_days) : data.posts_last_30_days,
    avg_posts_per_user: typeof data.avg_posts_per_user === "string" ? parseFloat(data.avg_posts_per_user) : data.avg_posts_per_user,
  });
});

// GET /api/analytics/top-authors — admin-only top authors
analyticsRouter.get("/top-authors", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { rows } = await pool.query(`
    WITH author_stats AS (
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        COUNT(p.id)::INT AS post_count,
        MAX(p.created_at) AS latest_post_at
      FROM users u
      LEFT JOIN posts p ON u.id = p.user_id
      GROUP BY u.id, u.name, u.email
    )
    SELECT user_id, name, email, post_count, latest_post_at
    FROM author_stats
    ORDER BY post_count DESC
  `);

  const result = rows.map((row: { user_id: number; name: string; email: string; post_count: string | number; latest_post_at: string | null }) => ({
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    post_count: typeof row.post_count === "string" ? parseInt(row.post_count) : row.post_count,
    latest_post_at: row.latest_post_at,
  }));

  res.json(result);
});

// GET /api/analytics/activity?days=N — admin-only daily activity
analyticsRouter.get("/activity", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(1, parseInt(req.query.days as string) || 7), 365);

  const { rows } = await pool.query(`
    WITH date_range AS (
      SELECT generate_series(
        NOW()::date - ($1 - 1) * INTERVAL '1 day',
        NOW()::date,
        INTERVAL '1 day'
      )::date AS date
    ),
    user_activity AS (
      SELECT created_at::date AS date, COUNT(*)::INT AS new_users
      FROM users
      WHERE created_at >= NOW()::date - ($1 - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    ),
    post_activity AS (
      SELECT created_at::date AS date, COUNT(*)::INT AS new_posts
      FROM posts
      WHERE created_at >= NOW()::date - ($1 - 1) * INTERVAL '1 day'
      GROUP BY created_at::date
    )
    SELECT
      dr.date,
      COALESCE(ua.new_users, 0)::INT AS new_users,
      COALESCE(pa.new_posts, 0)::INT AS new_posts
    FROM date_range dr
    LEFT JOIN user_activity ua ON dr.date = ua.date
    LEFT JOIN post_activity pa ON dr.date = pa.date
    ORDER BY dr.date ASC
  `, [days]);

  const result = rows.map((row: { date: string; new_users: string | number; new_posts: string | number }) => ({
    date: row.date,
    new_users: typeof row.new_users === "string" ? parseInt(row.new_users) : row.new_users,
    new_posts: typeof row.new_posts === "string" ? parseInt(row.new_posts) : row.new_posts,
  }));

  res.json(result);
});
