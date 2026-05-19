import { type Request, type Response, type NextFunction } from "express";
import { verifyToken } from "../auth.js";
import { pool } from "../db.js";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; role: string };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const token = header.slice(7);
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [payload.userId]);
    if (rows.length === 0) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = { userId: payload.userId, role: rows[0].role };
    next();
  } catch (err) {
    next(err);
  }
}
