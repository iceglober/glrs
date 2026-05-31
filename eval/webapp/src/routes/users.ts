import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.get("/", async (req: Request, res: Response) => {
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
        `SELECT * FROM users
         WHERE (created_at, id) < ($1::timestamp, $2)
         ORDER BY created_at DESC, id DESC
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
      `SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT $1`,
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

usersRouter.get("/:id", async (req: Request, res: Response) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
  res.json(rows[0]);
});

usersRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const { name, email } = req.body;
  if (!name || !email) { res.status(400).json({ error: "name and email are required" }); return; }
  const { rows } = await pool.query("INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *", [name, email]);
  res.status(201).json(rows[0]);
});

usersRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (req.user!.userId !== id && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING *", [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
  res.status(204).send();
});
