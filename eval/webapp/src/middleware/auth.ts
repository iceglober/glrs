import { type Request, type Response, type NextFunction } from "express";
import { pool } from "../db.js";
import { verifyToken } from "../auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; role: string };
    }
  }
}

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

  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [payload.userId]);
  if (rows.length === 0) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  req.user = { userId: payload.userId, role: rows[0].role };
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
