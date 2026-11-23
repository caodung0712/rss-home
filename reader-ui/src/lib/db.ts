import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * Shared PostgreSQL connection pool connected to the Miniflux database.
 */
export function getDbPool(): Pool | null {
  const connStr = (process.env.DATABASE_URL || "").trim();
  if (!connStr) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: connStr,
      max: 6,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 4000,
    });
  }
  return pool;
}
