import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { hashPassword, verifyPassword, generateToken } from "../auth.js";

export const authRouter = Router();

// POST /api/auth/register
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

  const passwordHash = hashPassword(password);

  try {
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role, created_at",
      [name, email, passwordHash],
    );

    const user = rows[0];
    const token = generateToken(user.id, user.role);

    // Insert session
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiresAt],
    );

    res.status(201).json({ user, token });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes("duplicate key") &&
      err.message.includes("email")
    ) {
      res.status(409).json({ error: "email already registered" });
      return;
    }
    throw err;
  }
});

// POST /api/auth/login
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

  if (rows.length === 0) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const user = rows[0];

  if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const token = generateToken(user.id, user.role);

  // Insert session
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [user.id, token, expiresAt],
  );

  // Don't return password_hash
  const { password_hash: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});
