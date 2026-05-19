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

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { rows } = await pool.query(
    "SELECT role FROM users WHERE id = $1",
    [payload.userId],
  );
  if (rows.length === 0) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = { userId: payload.userId, role: rows[0].role as string };
  next();
}
