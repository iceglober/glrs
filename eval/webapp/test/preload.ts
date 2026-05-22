import { pool } from "../src/db.js";

// auth.test.ts and auth-protected.test.ts both call pool.end() in afterAll.
// Because bun test (without --parallel) runs all files in one process and shares
// module singletons, that call terminates the pg.Pool for every file that is still
// running.  Patch pool.end() to a no-op so the pool stays alive for the whole
// test run.  Bun force-exits after printing the summary, so idle connections do
// not cause the process to hang.
const realEnd = pool.end.bind(pool);
(pool as any).end = () => Promise.resolve();
process.on("exit", () => { realEnd().catch(() => {}); });
