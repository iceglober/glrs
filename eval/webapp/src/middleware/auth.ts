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

/**
 * Middleware that requires the authenticated user to have admin role.
 * Must be used after requireAuth (or calls it internally).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // First ensure the user is authenticated
  requireAuth(req, res, () => {
    // requireAuth calls next() only on success, so req.user is set here
    if (req.user!.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
