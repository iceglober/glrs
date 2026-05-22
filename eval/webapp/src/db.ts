import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://eval:eval@localhost:5433/evaldb";

export const pool = new Pool({ connectionString: DATABASE_URL });
