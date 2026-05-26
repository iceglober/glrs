import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/:postId/comments", async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT c.*, u.name AS author_name
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.post_id = $1
     ORDER BY c.created_at ASC`,
    [req.params.postId],
  );
  res.json(rows);
});

router.post("/:postId/comments", requireAuth, async (req: Request, res: Response) => {
  const { body } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO comments (post_id, user_id, body) VALUES ($1, $2, $3) RETURNING *",
    [req.params.postId, req.user!.userId, body],
  );
  res.status(201).json(rows[0]);
});

router.delete("/:postId/comments/:id", requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    "SELECT * FROM comments WHERE id = $1 AND post_id = $2",
    [req.params.id, req.params.postId],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  const comment = rows[0];
  if (comment.user_id !== req.user!.userId && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await pool.query("DELETE FROM comments WHERE id = $1", [req.params.id]);
  res.status(204).send();
});

export default router;
