import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Queryable {
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function createDatabase(): Promise<Database> {
  const dataDir = process.env.WMS_DATA_DIR;
  if (dataDir) {
    if (dataDir !== "memory://") await mkdir(dataDir, { recursive: true });
    const db = new PGlite(dataDir);
    await db.waitReady;
    return db as unknown as Database;
  }
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://wms:wms@127.0.0.1:5440/artmate_wms",
  });
  await pool.query("SELECT 1");
  return {
    query: async (sql, params) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows };
    },
    exec: async (sql) => pool.query(sql),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(84652023)");
        const result = await fn({
          query: async (sql, params) => {
            const result = await client.query(sql, params);
            return { rows: result.rows };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => pool.end(),
  };
}
