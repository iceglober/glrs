import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const postsRouter = Router();

// GET /api/posts — paginated list
postsRouter.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);
  const cursorParam = req.query.cursor as string | undefined;

  let rows: Record<string, unknown>[];
  if (cursorParam) {
    let cursor: { id: number; created_at: string };
    try {
      cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString());
      if (!cursor.id || !cursor.created_at) throw new Error("invalid");
    } catch {
      res.status(400).json({ error: "invalid cursor" });
      return;
    }
    ({ rows } = await pool.query(
      `SELECT * FROM posts
       WHERE (created_at, id) < ($1::timestamptz, $2::int)
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [cursor.created_at, cursor.id, limit + 1],
    ));
  } else {
    ({ rows } = await pool.query(
      "SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT $1",
      [limit + 1],
    ));
  }

  const has_more = rows.length > limit;
  if (has_more) rows = rows.slice(0, limit);
  const last = rows[rows.length - 1] as { id: number; created_at: string } | undefined;
  const next_cursor = has_more && last
    ? Buffer.from(JSON.stringify({ id: last.id, created_at: last.created_at })).toString("base64url")
    : null;

  res.json({ data: rows, next_cursor, has_more });
});

// GET /api/posts/search — search with full-text indexing
postsRouter.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT *, ts_rank(search_vector, query) AS rank,
            ts_headline('english', body, query, 'StartSel=<b>,StopSel=</b>') AS headline
     FROM posts, to_tsquery('english', $1) AS query
     WHERE search_vector @@ query ORDER BY rank DESC`,
    [q],
  );
  res.json(rows);
});

// GET /api/posts/:id — get by id
postsRouter.get("/:id", async (req: Request, res: Response) => {
  const { rows } = await pool.query("SELECT * FROM posts WHERE id = $1", [
    req.params.id,
  ]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  res.json(rows[0]);
});

// POST /api/posts — create (user_id taken from auth token)
postsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const { title, body } = req.body;
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  const { rows } = await pool.query(
    "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING *",
    [title, body, req.user!.userId],
  );
  res.status(201).json(rows[0]);
});

// PUT /api/posts/:id — update
postsRouter.put("/:id", requireAuth, async (req: Request, res: Response) => {
  const { title, body } = req.body;
  const { rows } = await pool.query(
    "UPDATE posts SET title = COALESCE($1, title), body = COALESCE($2, body) WHERE id = $3 RETURNING *",
    [title ?? null, body ?? null, req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  res.json(rows[0]);
});

// DELETE /api/posts/:id — delete
postsRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    "DELETE FROM posts WHERE id = $1 RETURNING *",
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  res.status(204).send();
});
