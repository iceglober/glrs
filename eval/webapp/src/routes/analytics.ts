import { Router, type Request, type Response } from "express";

export const analyticsRouter = Router();

// Placeholder — analytics endpoints will be implemented in a later wave.
analyticsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Analytics API — not yet implemented" });
});
