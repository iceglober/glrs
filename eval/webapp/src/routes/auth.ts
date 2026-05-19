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
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }

  const passwordHash = await hashPassword(password);

  let user: { id: number; name: string; email: string; role: string };
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role",
      [name, email, passwordHash],
    );
    user = rows[0];
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "email already exists" });
      return;
    }
    throw err;
  }

  const token = generateToken(user.id);
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
    [user.id, token],
  );

  res.status(201).json({ user, token });
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const { rows } = await pool.query(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
    [email],
  );
  if (rows.length === 0) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const user = rows[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const token = generateToken(user.id);
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
    [user.id, token],
  );

  const { password_hash: _, ...safeUser } = user;
  res.status(200).json({ user: safeUser, token });
});
