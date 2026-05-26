import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const tagsRouter = Router();

tagsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO tags (name) VALUES ($1) RETURNING *",
      [name],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Tag already exists" });
      return;
    }
    throw err;
  }
});

tagsRouter.get("/", async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT t.*, COUNT(pt.post_id)::int AS post_count
     FROM tags t
     LEFT JOIN post_tags pt ON pt.tag_id = t.id
     GROUP BY t.id
     ORDER BY t.name`,
  );
  res.json(rows);
});

export default tagsRouter;

export const postTagsRouter = Router({ mergeParams: true });

postTagsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const { tagId } = req.body;
  const { postId } = req.params;
  if (!tagId) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) RETURNING *",
      [postId, tagId],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Tag already associated with this post" });
      return;
    }
    if (err.code === "23503") {
      res.status(404).json({ error: "Post or tag not found" });
      return;
    }
    throw err;
  }
});

postTagsRouter.get("/", async (req: Request, res: Response) => {
  const { postId } = req.params;
  const { rows } = await pool.query(
    `SELECT t.* FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = $1
     ORDER BY t.name`,
    [postId],
  );
  res.json(rows);
});

postTagsRouter.delete("/:tagId", requireAuth, async (req: Request, res: Response) => {
  const { postId, tagId } = req.params;
  const { rows } = await pool.query(
    "DELETE FROM post_tags WHERE post_id = $1 AND tag_id = $2 RETURNING *",
    [postId, tagId],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Association not found" });
    return;
  }
  res.status(204).send();
});
