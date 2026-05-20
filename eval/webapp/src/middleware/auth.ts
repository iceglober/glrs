import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../auth.js";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Middleware that requires a valid Bearer token in the Authorization header.
 * Sets req.user with the decoded token payload.
 */
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

  req.user = payload;
  next();
}
