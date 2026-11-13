import { expect, test, type Page } from "@playwright/test";
import { scheduleLesson } from "../fixtures/actions";
import { apiAs, login } from "../fixtures/auth";
import { q, resetDb } from "../fixtures/db";
import { APP, IDS } from "../fixtures/env";
import { PIXEL_7, endedLessonThisMonth, idr, wibDate, wibParts } from "../fixtures/time";

test.use(PIXEL_7);
test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

const classPage = `${APP}/tutor/classes/${IDS.mathClass}`;
const thisMonth = wibParts(new Date()).month;
const monthPage = `${APP}/tutor/logbooks/${IDS.mathClass}/${thisMonth}`;

async function as(page: Page, who: "tutor1" | "tutor2", path: string) {
  await page.context().clearCookies();
  await login(page, who);
  await page.goto(path);
}

async function fillSchedule(page: Page, date: string, start: string, end: string) {
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Starts (WIB)").fill(start);
  await page.getByLabel("Ends (WIB)").fill(end);
}

let endedLessonId = "";

test.describe("Tutor journey", () => {
  test("TUT-01 teaching home @p0", async ({ page }) => {
    await as(page, "tutor1", `${APP}/tutor`);
    await expect(page.getByRole("heading", { name: "Upcoming lessons" })).toBeVisible();
    await expect(page.getByText(/16:00–17:30 WIB/)).toHaveCount(2);
    await expect(page.getByText("1 active student(s)")).toBeVisible();
  });

  test("TUT-11 earnings: approved vs pending @p0", async ({ page }) => {
    await as(page, "tutor1", `${APP}/tutor/earnings`);
    const approved = page.locator('[data-slot="card"]').filter({ hasText: "Approved" }).first();
    const pending = page.locator('[data-slot="card"]').filter({ hasText: "Pending approval" });
    await expect(approved).toContainText(idr(300000));
    await expect(pending).toContainText(idr(300000));
    await expect(page.getByText(`1h 30m × ${idr(100000)}/h`)).toHaveCount(4);
    await expect(page.getByText(idr(150000), { exact: true })).toHaveCount(4);
  });

  test("TUT-05 tutors never receive student rates or invoice data @p0", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/") && r.request().method() === "GET") bodies.push(await r.text().catch(() => ""));
    });
    await as(page, "tutor1", `${APP}/tutor`);
    for (const p of [classPage, `${APP}/tutor/logbooks`, monthPage, `${APP}/tutor/earnings`]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
    }
    expect(bodies.length).toBeGreaterThan(4);
    for (const b of bodies) expect(b).not.toMatch(/studentRatePerHour|invoice|paidMinutes|"ratePerHour":150000/i);
    await expect(page.getByText("/ hour")).toHaveCount(0);
  });

  test("TUT-02 schedule a lesson in WIB @p0", async ({ page }) => {
    await as(page, "tutor1", classPage);
    await fillSchedule(page, wibDate(30), "16:00", "17:30");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Lesson scheduled with 1 student(s)")).toBeVisible();
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short" }).format(
      new Date(`${wibDate(30)}T16:00:00+07:00`),
    );
    await expect(page.getByText(`${label}, 16:00–17:30 WIB`)).toBeVisible();
  });

  test("TUT-03 end before start is blocked in the form @p0", async ({ page }) => {
    await as(page, "tutor1", classPage);
    await fillSchedule(page, wibDate(31), "17:00", "16:00");
    await expect(page.getByText("The end time must be after the start time.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
  });

  test("TUT-04 overlapping lesson is rejected @p0", async ({ page }) => {
    await as(page, "tutor1", classPage);
    await fillSchedule(page, wibDate(30), "16:30", "18:00");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "overlaps another lesson for the same tutor" })).toBeVisible();
    const [{ n }] = await q<{ n: number }>(
      "SELECT count(*)::int AS n FROM lessons WHERE starts_at = $1::timestamptz",
      [`${wibDate(30)}T16:30:00+07:00`],
    );
    expect(n).toBe(0);
  });

  test("TUT-16 students without enough hours are reported as skipped @p2", async ({ page }) => {
    // student1 has 3h free to book (12h paid − 6h used − 3h reserved, + the TUT-02 lesson = 1h 30m left).
    await as(page, "tutor1", classPage);
    await fillSchedule(page, wibDate(40), "10:00", "14:00");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Lesson scheduled with 0 student(s)")).toBeVisible();
    await expect(page.getByText("Not added (not enough hours): Dimas Saputra")).toBeVisible();
  });

  test("TUT-10 cancel a lesson with a reason @p0", async ({ page }) => {
    await as(page, "tutor1", classPage);
    const row = page.locator("li").filter({ hasText: "10:00–14:00 WIB" });
    await row.getByRole("button", { name: "Cancel" }).click();
    await page.getByLabel("Reason (shown to students)").fill("Room unavailable");
    await page.getByRole("button", { name: "Cancel lesson" }).click();
    await expect(page.getByText("Lesson cancelled — students' hours were released")).toBeVisible();
    await expect(page.locator("li").filter({ hasText: "10:00–14:00 WIB" })).toContainText("Cancelled: Room unavailable");
  });

  test("TUT-14 another tutor's class is not visible @p1", async ({ page }) => {
    await as(page, "tutor2", classPage);
    await expect(page.getByText("Class not found")).toBeVisible();
    await expect(page.getByText("Dimas Saputra")).toHaveCount(0);
  });

  test("TUT-13 an approved month is read-only @p1", async ({ page }) => {
    const [{ m }] = await q<{ m: string }>("SELECT to_char(month,'YYYY-MM') AS m FROM logbooks WHERE id = $1", [IDS.approvedLogbook]);
    await as(page, "tutor1", `${APP}/tutor/logbooks/${IDS.mathClass}/${m}`);
    await expect(page.getByRole("alert").filter({ hasText: "Approved" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /submit/i })).toHaveCount(0);
  });

  test("TUT-15 entry form validates every field @p1", async ({ page }) => {
    const tutor = await apiAs("tutor1");
    const t = endedLessonThisMonth();
    const res = await tutor.post("/tutor/lessons", { data: { classId: IDS.mathClass, startsAt: t.startsAt, endsAt: t.endsAt } });
    expect(res.status(), await res.text()).toBe(201);
    endedLessonId = (await res.json()).lessonId;

    await as(page, "tutor1", monthPage);
    await page.getByRole("button", { name: "Save entry" }).click();
    for (const msg of ["Add a topic", "Describe what happened", "Add your observation", "Say what comes next"]) {
      await expect(page.getByText(msg)).toBeVisible();
    }
    const [{ n }] = await q<{ n: number }>("SELECT count(*)::int AS n FROM logbook_entries WHERE lesson_id = $1", [endedLessonId]);
    expect(n).toBe(0);
  });

  test("TUT-06 write the entry for an ended lesson @p0", async ({ page }) => {
    await as(page, "tutor1", monthPage);
    const card = page.locator(`#lesson-${endedLessonId}`);
    await card.getByLabel("Topic").fill("Simultaneous equations");
    await card.getByLabel("What happened").fill("Solved pairs of equations by elimination, then by substitution.");
    await card.getByLabel("Your observation").fill("Elimination is solid; substitution needs more practice.");
    await card.getByLabel("What comes next").fill("Word problems with two unknowns.");
    await card.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText(/Lesson \d+ saved/)).toBeVisible();
    await expect(card).toContainText("Simultaneous equations");
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
  });

  test("TUT-07 upcoming lessons can't be logged yet @p0", async ({ page }) => {
    // Make sure there is an upcoming lesson in this WIB month (one hour from now).
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(Date.now() + 120 * 60_000);
    test.skip(wibParts(end).month !== thisMonth, "too close to the end of the month");
    const tutor = await apiAs("tutor1");
    const res = await tutor.post("/tutor/lessons", {
      data: { classId: IDS.mathClass, startsAt: start.toISOString(), endsAt: end.toISOString() },
    });
    expect(res.status(), await res.text()).toBe(201);
    await as(page, "tutor1", monthPage);
    await expect(page.getByText("You can write this entry once the lesson has ended.").first()).toBeVisible();
  });

  test("TUT-08 submit is blocked until the month is complete @p0", async ({ page }) => {
    await as(page, "tutor1", monthPage);
    await expect(page.getByText(/lesson\(s\) this month have not happened yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalise & submit" })).toBeDisabled();
  });

  test("TUT-09 submit a complete month @p0", async ({ page }) => {
    // Cancel this month's remaining upcoming lessons so every lesson has ended and is logged.
    const tutor = await apiAs("tutor1");
    const upcoming = await q<{ id: string }>(
      `SELECT id FROM lessons WHERE class_id = $1 AND status = 'scheduled' AND ends_at > now()
         AND to_char(starts_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = $2`,
      [IDS.mathClass, thisMonth],
    );
    for (const l of upcoming) {
      expect((await tutor.post(`/tutor/lessons/${l.id}/cancel`, { data: { reason: "Moved to next month" } })).status()).toBe(200);
    }
    await as(page, "tutor1", monthPage);
    await page.getByRole("button", { name: "Finalise & submit" }).click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Submitted for review")).toBeVisible();
    await expect(page.getByText("Awaiting review").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("TUT-12 a sent-back logbook can be fixed and resubmitted @p1", async ({ page }) => {
    const admin = await apiAs("admin");
    const res = await admin.post(`/admin/logbooks/${IDS.submittedLogbook}/request-changes`, {
      data: { comment: "Please add the homework you set in lesson 2." },
    });
    expect(res.status()).toBe(200);

    await as(page, "tutor1", `${APP}/tutor`);
    const card = page.getByRole("link", { name: /was sent back/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByText("Please add the homework you set in lesson 2.").first()).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).nth(1).click();
    await page.getByLabel("What happened").fill("Paper squares, then ladder problems. Homework: worksheet 4.");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("Lesson 2 saved")).toBeVisible();
    await page.getByRole("button", { name: "Resubmit for review" }).click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Awaiting review").first()).toBeVisible();
  });
});
