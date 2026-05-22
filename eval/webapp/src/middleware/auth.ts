import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth.js";

// Augment Express Request with user info
declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; role: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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

  req.user = { userId: payload.userId, role: payload.role };
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // First ensure authentication
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
