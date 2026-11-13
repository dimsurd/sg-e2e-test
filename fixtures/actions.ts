import { expect, type APIRequestContext } from "@playwright/test";
import { IDS } from "./env";
import { wibDate, wibIso } from "./time";

/** Schedule a Math Group A lesson as tutor1 via the API. Returns the API body. */
export async function scheduleLesson(
  tutor: APIRequestContext,
  { daysFromNow, start, end, classId = IDS.mathClass }: { daysFromNow: number; start: string; end: string; classId?: string },
) {
  const date = wibDate(daysFromNow);
  const res = await tutor.post("/tutor/lessons", {
    data: { classId, startsAt: wibIso(date, start), endsAt: wibIso(date, end) },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { lessonId: string; added: number; skipped: { studentName: string }[] };
}

export async function json<T = any>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  return (await res.json()) as T;
}
