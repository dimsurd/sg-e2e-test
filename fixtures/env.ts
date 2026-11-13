import { readFileSync } from "node:fs";
import path from "node:path";

export const API = "http://localhost:4100";
export const APP = "http://localhost:3100";
export const BO = "http://localhost:3101";
/** Same server and credentials as sg-api/.env's DATABASE_URL, but its own database. */
function e2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  let base = "postgres://localhost:5432/star_generation";
  try {
    const line = readFileSync(path.resolve(import.meta.dirname, "../../sg-api/.env"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    if (line) base = line.slice("DATABASE_URL=".length).trim();
  } catch {
    // no .env: fall back to the passwordless local default
  }
  return base.replace(/\/[^/?]+(\?|$)/, "/star_generation_e2e$1");
}
export const E2E_DATABASE_URL = e2eDatabaseUrl();

export const PASSWORD = "Password123!";

/** Fixed ids from sg-api/db/seed.sql */
export const IDS = {
  admin: "00000000-0000-0000-0000-000000000001",
  tutor1: "00000000-0000-0000-0000-000000000011",
  tutor2: "00000000-0000-0000-0000-000000000012",
  student1: "00000000-0000-0000-0000-000000000021",
  student2: "00000000-0000-0000-0000-000000000022",
  student3: "00000000-0000-0000-0000-000000000023",
  mathClass: "00000000-0000-0000-0000-000000000101",
  student1Enrollment: "00000000-0000-0000-0000-000000000201",
  student1Invoice: "00000000-0000-0000-0000-000000000501",
  submittedLogbook: "00000000-0000-0000-0000-000000000401",
  approvedLogbook: "00000000-0000-0000-0000-000000000402",
  upcomingLesson1: "00000000-0000-0000-0000-000000000305",
  upcomingLesson2: "00000000-0000-0000-0000-000000000306",
} as const;

export type Who = "admin" | "tutor1" | "tutor2" | "student1" | "student2" | "student3";
export const email = (who: Who) => `${who}@stargeneration.test`;
