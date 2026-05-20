import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { hashPassword, verifyPassword, generateToken } from "../auth.js";

export const authRouter = Router();

interface RegisterRequest {
  name?: string;
  email?: string;
  password?: string;
}

interface LoginRequest {
  email?: string;
  password?: string;
}

authRouter.post("/register", async (req: Request<unknown, unknown, RegisterRequest>, res: Response) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email, and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name, email, passwordHash, "user"],
    );
    const user = rows[0];
    const token = generateToken(user.id, user.role);
    res.status(201).json({ user, token });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw err;
  }
});

authRouter.post("/login", async (req: Request<unknown, unknown, LoginRequest>, res: Response) => {
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
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const user = rows[0];
  const match = await verifyPassword(password, user.password_hash);

  if (!match) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = generateToken(user.id, user.role);
  res.status(200).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
  });
});
