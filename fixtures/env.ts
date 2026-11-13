export const API = "http://localhost:4100";
export const APP = "http://localhost:3100";
export const BO = "http://localhost:3101";
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/star_generation_e2e";

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
