import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";

export const postsRouter = Router();

postsRouter.get("/", async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT p.*, u.name AS author_name
     FROM posts p
     LEFT JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC`,
  );
  res.json(rows);
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

postsRouter.post("/", async (req: Request, res: Response) => {
  const { title, body, user_id } = req.body;
  if (!title || !body || !user_id) {
    res.status(400).json({ error: "title, body, and user_id are required" });
    return;
  }
  const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [user_id]);
  if (userCheck.rows.length === 0) {
    res.status(400).json({ error: "user_id does not reference an existing user" });
    return;
  }
  const { rows } = await pool.query(
    "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING *",
    [title, body, user_id],
  );
  res.status(201).json(rows[0]);
});

postsRouter.put("/:id", async (req: Request, res: Response) => {
  const { title, body } = req.body;
  if (title === undefined && body === undefined) {
    res.status(400).json({ error: "title or body is required" });
    return;
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

postsRouter.delete("/:id", async (req: Request, res: Response) => {
  const { rows } = await pool.query("DELETE FROM posts WHERE id = $1 RETURNING *", [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: "Post not found" }); return; }
  res.status(204).send();
});
