import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { hashPassword, verifyPassword, generateToken } from "../auth.js";

export const authRouter = Router();

authRouter.post("/register", async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email, and password are required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }

  const { rows: existing } = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const password_hash = await hashPassword(password);
  const { rows } = await pool.query(
    "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role",
    [name, email, password_hash],
  );
  const user = rows[0];
  const token = generateToken(user.id, user.role);
  res.status(201).json({ user, token });
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const { rows } = await pool.query(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
    [email],
  );
  if (rows.length === 0 || !rows[0].password_hash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const user = rows[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = generateToken(user.id, user.role);
  const { password_hash: _ph, ...userWithoutHash } = user;
  res.json({ user: userWithoutHash, token });
});
