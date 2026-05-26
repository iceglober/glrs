import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/tags", async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT t.*, COUNT(pt.post_id)::int AS post_count
     FROM tags t
     LEFT JOIN post_tags pt ON t.id = pt.tag_id
     GROUP BY t.id
     ORDER BY t.name`,
  );
  res.json(rows);
});

router.post("/tags", requireAuth, async (req: Request, res: Response) => {
  const { name } = req.body;
  try {
    const { rows } = await pool.query(
      "INSERT INTO tags (name) VALUES ($1) RETURNING *",
      [name],
    );
    res.status(201).json(rows[0]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Tag already exists" });
      return;
    }
    throw err;
  }
});

router.post("/posts/:postId/tags", requireAuth, async (req: Request, res: Response) => {
  const { tagId } = req.body;
  await pool.query(
    "INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [req.params.postId, tagId],
  );
  res.status(201).send();
});

router.delete("/posts/:postId/tags/:tagId", requireAuth, async (req: Request, res: Response) => {
  await pool.query(
    "DELETE FROM post_tags WHERE post_id = $1 AND tag_id = $2",
    [req.params.postId, req.params.tagId],
  );
  res.status(204).send();
});

router.get("/posts/:postId/tags", async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT t.*
     FROM tags t
     JOIN post_tags pt ON t.id = pt.tag_id
     WHERE pt.post_id = $1
     ORDER BY t.name`,
    [req.params.postId],
  );
  res.json(rows);
});

export default router;
