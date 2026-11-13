import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { E2E_DATABASE_URL } from "./env";

pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
const pool = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 2, options: "-c TimeZone=UTC" });
pool.on("error", () => undefined);

const seedSql = readFileSync(path.resolve(import.meta.dirname, "../../sg-api/db/seed.sql"), "utf8");

/** Wipe every row and re-run the seed. Fast, and keeps the API's connections alive. */
export async function resetDb() {
  await pool.query(`
    TRUNCATE audit_logs, tutor_earnings, logbook_reviews, logbook_entries, logbooks,
             lesson_participants, lessons, invoices, enrollments, classes, users CASCADE;
    ALTER SEQUENCE invoice_no_seq RESTART;
  `);
  await pool.query(seedSql);
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q<T>(sql, params);
  if (!rows[0]) throw new Error(`No row for: ${sql}`);
  return rows[0];
}
