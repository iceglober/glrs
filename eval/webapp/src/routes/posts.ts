import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const postsRouter = Router();

// GET /api/posts — list all
postsRouter.get("/", async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    "SELECT * FROM posts ORDER BY created_at DESC",
  );
  res.json(rows);
});

// GET /api/posts/search?q=<query> — full-text search (must be before /:id)
postsRouter.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT *, ts_rank(search_vector, query) AS rank,
            ts_headline('english', body, query) AS headline
     FROM posts, to_tsquery('english', $1) AS query
     WHERE search_vector @@ query
     ORDER BY rank DESC`,
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
