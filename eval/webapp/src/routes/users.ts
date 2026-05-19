import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const usersRouter = Router();

// GET /api/users — paginated list
usersRouter.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);
  const cursorParam = req.query.cursor as string | undefined;

  let rows: Record<string, unknown>[];
  if (cursorParam) {
    let cursor: { id: number };
    try {
      cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString());
      if (!cursor.id) throw new Error("invalid");
    } catch {
      res.status(400).json({ error: "invalid cursor" });
      return;
    }
    ({ rows } = await pool.query(
      "SELECT * FROM users WHERE id < $1 ORDER BY id DESC LIMIT $2",
      [cursor.id, limit + 1],
    ));
  } else {
    ({ rows } = await pool.query(
      "SELECT * FROM users ORDER BY id DESC LIMIT $1",
      [limit + 1],
    ));
  }

  const has_more = rows.length > limit;
  if (has_more) rows = rows.slice(0, limit);
  const last = rows[rows.length - 1] as { id: number } | undefined;
  const next_cursor = has_more && last
    ? Buffer.from(JSON.stringify({ id: last.id })).toString("base64url")
    : null;

  res.json({ data: rows, next_cursor, has_more });
});

// GET /api/users/:id — get by id
usersRouter.get("/:id", async (req: Request, res: Response) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [
    req.params.id,
  ]);
  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(rows[0]);
});

// POST /api/users — create
usersRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }
  const { rows } = await pool.query(
    "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
    [name, email],
  );
  res.status(201).json(rows[0]);
});

// PUT /api/users/:id — update
usersRouter.put("/:id", requireAuth, async (req: Request, res: Response) => {
  const { name, email } = req.body;
  const { rows } = await pool.query(
    "UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3 RETURNING *",
    [name ?? null, email ?? null, req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(rows[0]);
});

// DELETE /api/users/:id — delete (self or admin only)
usersRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const targetId = Number(req.params.id);
  if (req.user!.userId !== targetId && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { rows } = await pool.query(
    "DELETE FROM users WHERE id = $1 RETURNING *",
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(204).send();
});
