import express from "express";
import { join } from "path";
import { usersRouter } from "./routes/users.js";

export const app = express();

app.use(express.json());
app.use(express.static(join(import.meta.dir, "..", "public")));
app.use("/api/users", usersRouter);

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
