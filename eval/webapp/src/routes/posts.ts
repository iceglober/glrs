import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const postsRouter = Router();

// Search endpoint - MUST be before GET /:id to avoid route conflict
postsRouter.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "Query parameter q is required" });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.body, p.user_id, p.created_at,
              ts_headline('english', p.body, to_tsquery('english', $1)) AS headline
       FROM posts p, to_tsquery('english', $1) AS query
       WHERE p.search_vector @@ query
       ORDER BY ts_rank(p.search_vector, query) DESC`,
      [q]
    );
    res.json(rows);
  } catch (err: unknown) {
    // Handle invalid tsquery syntax
    const pgError = err as { code?: string };
    if (pgError.code === "42601") {
      res.status(400).json({ error: "Invalid search query syntax" });
      return;
    }
    throw err;
  }
});

postsRouter.get("/", async (req: Request, res: Response) => {
  const limitParam = req.query.limit as string | undefined;
  const cursor = req.query.cursor as string | undefined;

  let limit = 10;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  // Fetch one extra to determine has_more
  const fetchLimit = limit + 1;

  let rows: any[];
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      const { rows: result } = await pool.query(
        `SELECT p.*, u.name AS author_name
         FROM posts p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE (p.created_at, p.id) < ($1::timestamp, $2)
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $3`,
        [decoded.created_at, decoded.id, fetchLimit]
      );
      rows = result;
    } catch {
      res.status(400).json({ error: "Invalid cursor" });
      return;
    }
  } else {
    const { rows: result } = await pool.query(
      `SELECT p.*, u.name AS author_name
       FROM posts p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $1`,
      [fetchLimit]
    );
    rows = result;
  }

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastItem = data[data.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ id: lastItem.id, created_at: lastItem.created_at })
    ).toString("base64url");
  }

  res.json({ data, next_cursor: nextCursor, has_more: hasMore });
});

postsRouter.get("/:id", async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT p.*, u.name AS author_name
     FROM posts p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [req.params.id],
  );
  if (rows.length === 0) { res.status(404).json({ error: "Post not found" }); return; }
  res.json(rows[0]);
});

postsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const { title, body } = req.body;
  const user_id = req.user!.userId;
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  const { rows } = await pool.query(
    "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING *",
    [title, body, user_id],
  );
  res.status(201).json(rows[0]);
});

postsRouter.put("/:id", requireAuth, async (req: Request, res: Response) => {
  const { title, body } = req.body;
  if (title === undefined && body === undefined) {
    res.status(400).json({ error: "title or body is required" }); return;
  }
  const { rows } = await pool.query(
    `UPDATE posts
     SET title = COALESCE($1, title),
         body = COALESCE($2, body)
     WHERE id = $3
     RETURNING *`,
    [title ?? null, body ?? null, req.params.id],
  );
  if (rows.length === 0) { res.status(404).json({ error: "Post not found" }); return; }
  res.json(rows[0]);
});

postsRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query("DELETE FROM posts WHERE id = $1 RETURNING *", [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: "Post not found" }); return; }
  res.status(204).send();
});
