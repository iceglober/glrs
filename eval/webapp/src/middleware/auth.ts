import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth.js";
import { pool } from "../db.js";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; role: string };
    }
  }
}

/**
 * Middleware that requires a valid Bearer token.
 * Sets req.user = { userId, role } on success, returns 401 otherwise.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Look up user role from DB
  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [decoded.userId]);
  if (rows.length === 0) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  req.user = { userId: decoded.userId, role: rows[0].role };
  next();
}
