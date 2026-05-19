import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { hashPassword, verifyPassword, generateToken } from "../auth.js";

export const authRouter = Router();

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

authRouter.post("/register", async (req: Request, res: Response) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };
  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email, and password are required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }
  const password_hash = await hashPassword(password);
  let userRow: Record<string, unknown>;
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role",
      [name, email, password_hash],
    );
    userRow = rows[0];
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    throw err;
  }
  const token = generateToken(userRow.id as number);
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [userRow.id, token, new Date(Date.now() + TOKEN_TTL_MS)],
  );
  res.status(201).json({ user: userRow, token });
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
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
  const user = rows[0] as {
    id: number;
    name: string;
    email: string;
    role: string;
    password_hash: string;
  };
  if (!(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = generateToken(user.id);
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [user.id, token, new Date(Date.now() + TOKEN_TTL_MS)],
  );
  const { password_hash: _ph, ...userWithoutHash } = user;
  res.json({ user: userWithoutHash, token });
});
