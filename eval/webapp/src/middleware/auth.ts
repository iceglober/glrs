import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; role: string };
    }
  }
}

/**
 * Middleware that requires a valid Bearer token in the Authorization header.
 * Sets req.user with { userId, role } on success.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Fetch role from the database
  const { pool } = await import("../db.js");
  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [payload.userId]);
  if (rows.length === 0) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  req.user = { userId: payload.userId, role: rows[0].role };
  next();
}
