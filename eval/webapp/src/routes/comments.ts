import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  const { postId } = req.params;
  const { rows } = await pool.query(
    `SELECT c.*, u.name AS author_name
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.post_id = $1
     ORDER BY c.created_at ASC`,
    [postId],
  );
  res.json(rows);
});

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { postId } = req.params;
  const { body } = req.body;
  if (!body) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const { rows } = await pool.query(
    "INSERT INTO comments (post_id, user_id, body) VALUES ($1, $2, $3) RETURNING *",
    [postId, req.user!.userId, body],
  );
  const { rows: withAuthor } = await pool.query(
    `SELECT c.*, u.name AS author_name
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.id = $1`,
    [rows[0].id],
  );
  res.status(201).json(withAuthor[0]);
});

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { rows } = await pool.query("SELECT * FROM comments WHERE id = $1", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  const comment = rows[0];
  if (comment.user_id !== req.user!.userId && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await pool.query("DELETE FROM comments WHERE id = $1", [id]);
  res.status(204).send();
});

export default router;
