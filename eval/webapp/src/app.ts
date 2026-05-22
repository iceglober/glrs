import express from "express";
import { join } from "path";
import { usersRouter } from "./routes/users.js";
import { postsRouter } from "./routes/posts.js";
import { authRouter } from "./routes/auth.js";
import { analyticsRouter } from "./routes/analytics.js";

export const app = express();

app.use(express.json());

// Serve static files from public/
app.use(express.static(join(import.meta.dir, "..", "public")));

// Mount routes
app.use("/api/users", usersRouter);
app.use("/api/posts", postsRouter);
app.use("/api/auth", authRouter);
app.use("/api/analytics", analyticsRouter);

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal server error" });
  },
);
