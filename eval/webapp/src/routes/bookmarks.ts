import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT b.*, p.title AS post_title, u.name AS author_name
     FROM bookmarks b
     JOIN posts p ON b.post_id = p.id
     JOIN users u ON p.user_id = u.id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [req.user!.userId],
  );
  res.json(rows);
});

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { postId } = req.body;

  const { rows: postRows } = await pool.query("SELECT id FROM posts WHERE id = $1", [postId]);
  if (postRows.length === 0) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  try {
    const { rows } = await pool.query(
      "INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) RETURNING *",
      [req.user!.userId, postId],
    );
    res.status(201).json(rows[0]);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      res.status(409).json({ error: "Bookmark already exists" });
      return;
    }
    throw err;
  }
});

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query("SELECT * FROM bookmarks WHERE id = $1", [req.params.id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Bookmark not found" });
    return;
  }
  if (rows[0].user_id !== req.user!.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await pool.query("DELETE FROM bookmarks WHERE id = $1", [req.params.id]);
  res.status(204).send();
});

export default router;
