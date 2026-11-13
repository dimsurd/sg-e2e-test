import { expect, test } from "@playwright/test";
import { apiAs, login } from "../fixtures/auth";
import { one, resetDb } from "../fixtures/db";
import { APP, BO, IDS } from "../fixtures/env";
import { DESKTOP, PIXEL_7, wibDate } from "../fixtures/time";

test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

test.describe("Time zones (WIB)", () => {
  test.use({ timezoneId: "Europe/London" }); // a device that is NOT in WIB

  test("TZ-01 a London browser still schedules and shows WIB @p0", async ({ browser }) => {
    const date = wibDate(35);
    const tutorCtx = await browser.newContext({ ...PIXEL_7, timezoneId: "Europe/London" });
    const tutor = await tutorCtx.newPage();
    await login(tutor, "tutor1");
    await tutor.goto(`${APP}/tutor/classes/${IDS.mathClass}`);
    await tutor.getByLabel("Date").fill(date);
    await tutor.getByLabel("Starts (WIB)").fill("16:00");
    await tutor.getByLabel("Ends (WIB)").fill("17:30");
    await tutor.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(tutor.getByText(/Lesson scheduled/)).toBeVisible();

    const row = await one<{ utc: string }>(
      "SELECT to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS utc FROM lessons ORDER BY created_at DESC LIMIT 1",
    );
    const expectedUtcDate = new Date(`${date}T09:00:00Z`).toISOString().slice(0, 10);
    expect(row.utc).toBe(`${expectedUtcDate} 09:00`);

    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short" }).format(
      new Date(`${date}T16:00:00+07:00`),
    );
    const slot = `${label}, 16:00–17:30 WIB`;
    await expect(tutor.getByText(slot)).toBeVisible();

    const studentCtx = await browser.newContext({ ...PIXEL_7, timezoneId: "Europe/London" });
    const student = await studentCtx.newPage();
    await login(student, "student1");
    await student.goto(`${APP}/student/classes/${IDS.mathClass}`);
    await expect(student.getByText(slot)).toBeVisible();

    const adminCtx = await browser.newContext({ ...DESKTOP, timezoneId: "America/Los_Angeles" });
    const admin = await adminCtx.newPage();
    await login(admin, "admin");
    await admin.goto(`${BO}/lessons`);
    await expect(admin.getByText(slot)).toBeVisible();
  });

  test("TZ-02 a late-night lesson on the last day belongs to that WIB month @p1", async () => {
    // Last day of next month, 23:30–00:30 WIB (crosses midnight; UTC is still the same day 16:30).
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 2; // next month, 1-based
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(((m - 1) % 12) + 1).padStart(2, "0");
    const yy = m > 12 ? y + 1 : y;
    const month = `${yy}-${mm}`;
    const startsAt = `${month}-${String(lastDay).padStart(2, "0")}T23:30:00+07:00`;
    const endsAt = new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString();

    const tutor = await apiAs("tutor1");
    const res = await tutor.post("/tutor/lessons", { data: { classId: IDS.mathClass, startsAt, endsAt } });
    expect(res.status(), await res.text()).toBe(201);
    const { lessonId } = await res.json();

    const inMonth = await (await tutor.get(`/tutor/classes/${IDS.mathClass}/logbooks/${month}`)).json();
    expect(inMonth.logbook.lessons.map((l: { id: string }) => l.id)).toContain(lessonId);
    const nextMonthNum = Number(mm) === 12 ? 1 : Number(mm) + 1;
    const nextMonth = `${Number(mm) === 12 ? yy + 1 : yy}-${String(nextMonthNum).padStart(2, "0")}`;
    const after = await (await tutor.get(`/tutor/classes/${IDS.mathClass}/logbooks/${nextMonth}`)).json();
    expect(after.logbook.lessons.map((l: { id: string }) => l.id)).not.toContain(lessonId);
  });

  test("TZ-03 every time of day on screen is labelled WIB @p2", async ({ browser }) => {
    const pages: [string, "tutor1" | "student1" | "admin", typeof PIXEL_7][] = [
      [`${APP}/tutor`, "tutor1", PIXEL_7],
      [`${APP}/tutor/classes/${IDS.mathClass}`, "tutor1", PIXEL_7],
      [`${APP}/student/classes/${IDS.mathClass}`, "student1", PIXEL_7],
      [`${BO}/lessons`, "admin", DESKTOP],
      [`${BO}/logbooks/${IDS.submittedLogbook}`, "admin", DESKTOP],
    ];
    for (const [url, who, device] of pages) {
      const ctx = await browser.newContext({ ...device, timezoneId: "Europe/London" });
      const page = await ctx.newPage();
      await login(page, who);
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      // Text nodes showing a clock time must also say WIB (form inputs excluded).
      const offenders = await page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const n = walker.currentNode as Text;
          const t = n.textContent ?? "";
          if (/\b\d{2}:\d{2}\b/.test(t) && !/WIB/.test(n.parentElement?.textContent ?? "")) out.push(t.trim());
        }
        return out;
      });
      expect(offenders, url).toEqual([]);
      await ctx.close();
    }
  });
});
