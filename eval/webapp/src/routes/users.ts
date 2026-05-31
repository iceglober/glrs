import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.get("/", async (req: Request, res: Response) => {
  const { rows } = await pool.query("SELECT * FROM users ORDER BY id DESC");
  res.json(rows);
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
