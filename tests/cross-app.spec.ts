import { expect, test, type Browser, type Page } from "@playwright/test";
import { scheduleLesson } from "../fixtures/actions";
import { apiAs, login } from "../fixtures/auth";
import { one, q, resetDb } from "../fixtures/db";
import { APP, BO, IDS, type Who } from "../fixtures/env";
import { DESKTOP, PIXEL_7, endedSlotToday, idr, wibParts } from "../fixtures/time";

test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

/** One browser context per person, like three people on three devices. */
async function personOn(browser: Browser, who: Who): Promise<Page> {
  const ctx = await browser.newContext({ ...(who === "admin" ? DESKTOP : PIXEL_7), timezoneId: "Asia/Jakarta" });
  const page = await ctx.newPage();
  await login(page, who);
  return page;
}

const h = (m: number) => (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);
const month = wibParts(new Date()).month;
let newLessonId = "";
let logbookId = "";

test.describe("Cross-app consistency", () => {
  test("X-01 + X-04 full flow: enroll → pay → teach → log → approve @p0", async ({ browser }) => {
    const slot = endedSlotToday();
    test.skip(!slot, "needs a lesson that ended earlier today (WIB)");

    const student = await personOn(browser, "student2");
    const tutor = await personOn(browser, "tutor1");
    const admin = await personOn(browser, "admin");

    // Student enrolls and pays.
    await student.goto(`${APP}/student/browse`);
    await student.getByRole("button", { name: "Enroll" }).click();
    await student.getByRole("button", { name: "Enroll & get invoice" }).click();
    await expect(student).toHaveURL(`${APP}/student/invoices`);
    await student.getByRole("button", { name: `Pay ${idr(1800000)}` }).click();
    await student.getByRole("button", { name: "Simulate payment" }).click();
    await expect(student.getByText("Payment received — thank you!")).toBeVisible();

    // Admin sees the payment.
    await admin.goto(`${BO}/invoices`);
    await admin.getByRole("tab", { name: "Paid", exact: true }).click();
    await expect(admin.locator("tr").filter({ hasText: "Eka Wulandari" })).toContainText("Paid");

    // Tutor records a lesson held earlier today (WIB) and logs it.
    await tutor.goto(`${APP}/tutor/classes/${IDS.mathClass}`);
    await tutor.getByLabel("Date").fill(slot!.date);
    await tutor.getByLabel("Starts (WIB)").fill(slot!.start);
    await tutor.getByLabel("Ends (WIB)").fill(slot!.end);
    await tutor.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(tutor.getByText("Lesson scheduled with 2 student(s)")).toBeVisible();
    newLessonId = (await one<{ id: string }>("SELECT id FROM lessons ORDER BY created_at DESC LIMIT 1")).id;

    // Cancel the rest of this month's upcoming lessons so the month can be submitted.
    const t = await apiAs("tutor1");
    const rest = await q<{ id: string }>(
      `SELECT id FROM lessons WHERE class_id = $1 AND status = 'scheduled' AND ends_at > now()
         AND to_char(starts_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM') = $2`,
      [IDS.mathClass, month],
    );
    for (const l of rest) await t.post(`/tutor/lessons/${l.id}/cancel`, { data: { reason: "Rescheduled" } });

    await tutor.goto(`${APP}/tutor/logbooks/${IDS.mathClass}/${month}`);
    const card = tutor.locator(`#lesson-${newLessonId}`);
    await card.getByLabel("Topic").fill("Inequalities");
    await card.getByLabel("What happened").fill("Solved linear inequalities and drew them on number lines.");
    await card.getByLabel("Your observation").fill("Eka grasped it quickly; Dimas mixed up the flip rule.");
    await card.getByLabel("What comes next").fill("Inequality word problems.");
    await card.getByRole("button", { name: "Save entry" }).click();
    await expect(tutor.getByText(/Lesson \d+ saved/)).toBeVisible();
    await tutor.getByRole("button", { name: "Finalise & submit" }).click();
    await tutor.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(tutor.getByText("Submitted for review")).toBeVisible();

    // X-04: not visible to students before approval.
    await student.goto(`${APP}/student/classes/${IDS.mathClass}`);
    await student.getByRole("tab", { name: /Logbooks/ }).click();
    await expect(student.getByText("Inequalities", { exact: true })).toHaveCount(0);

    // Admin approves.
    logbookId = (await one<{ id: string }>("SELECT id FROM logbooks WHERE class_id = $1 AND to_char(month,'YYYY-MM') = $2", [
      IDS.mathClass,
      month,
    ])).id;
    await admin.goto(`${BO}/logbooks/${logbookId}`);
    await admin.getByRole("button", { name: "Approve" }).click();
    await admin.getByRole("button", { name: /^Approve · / }).click();
    await expect(admin.getByText(/Approved · earnings recorded for 1 lesson/)).toBeVisible();

    // X-04: visible to students after approval, with the entry.
    await student.reload();
    await student.getByRole("tab", { name: /Logbooks/ }).click();
    await expect(student.getByText("Inequalities", { exact: true })).toBeVisible();
    await expect(student.getByText("Eka grasped it quickly")).toBeVisible();

    // Tutor sees the lesson as approved earnings.
    await tutor.goto(`${APP}/tutor/earnings`);
    const shown = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }).format(
      new Date(`${slot!.date}T12:00:00+07:00`),
    );
    const line = tutor.locator("li").filter({ hasText: `${shown} · 1h ×` });
    await expect(line.first()).toContainText(idr(100000));
    await expect(line.first()).toContainText("Approved");
  });

  test("X-02 hours agree across student, tutor and admin @p0", async ({ browser }) => {
    const b = await one<{ remaining: number; available: number; used: number; reserved: number }>(
      `SELECT remaining_minutes AS remaining, available_minutes AS available, used_minutes AS used, reserved_minutes AS reserved
         FROM v_enrollment_balance WHERE enrollment_id = $1`,
      [IDS.student1Enrollment],
    );
    const student = await personOn(browser, "student1");
    await student.goto(`${APP}/student`);
    const card = student.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(card).toContainText(h(b.remaining));
    await expect(card).toContainText("left of 12h");
    await expect(card).toContainText(`${h(b.used)} used · ${h(b.reserved)} booked`);

    const tutor = await personOn(browser, "tutor1");
    await tutor.goto(`${APP}/tutor/classes/${IDS.mathClass}`);
    await expect(tutor.locator("li").filter({ hasText: "Dimas Saputra" })).toContainText(`${h(Math.max(0, b.available))} free to book`);

    const admin = await personOn(browser, "admin");
    await admin.goto(`${BO}/students`);
    const row = admin.locator("tr").filter({ hasText: "Dimas Saputra" });
    await expect(row).toContainText(`${h(b.used)} used · ${h(b.reserved)} booked · 12h paid`);
    await expect(row).toContainText(h(b.remaining));
  });

  test("X-03 earnings agree between the admin preview, admin earnings and tutor @p0", async ({ browser }) => {
    test.skip(!logbookId, "depends on X-01");
    const admin = await personOn(browser, "admin");
    await admin.goto(`${BO}/logbooks/${logbookId}`);
    const previewTotal = await admin
      .locator('[data-slot="card"]')
      .filter({ hasText: "Tutor earnings" })
      .locator("span.text-lg")
      .innerText();

    const total = await one<{ s: number }>("SELECT sum(amount)::bigint AS s FROM tutor_earnings WHERE tutor_id = $1", [IDS.tutor1]);
    await admin.goto(`${BO}/earnings`);
    await expect(admin.locator('[data-slot="card"]').filter({ hasText: "Approved" }).first()).toContainText(idr(total.s));

    const tutor = await personOn(browser, "tutor1");
    await tutor.goto(`${APP}/tutor/earnings`);
    await expect(tutor.locator('[data-slot="card"]').filter({ hasText: "Approved" }).first()).toContainText(idr(total.s));
    expect(previewTotal.replace(/\s/g, " ")).toBe(idr(100000).replace(/\s/g, " "));
  });

  test("X-05 a cancellation shows up for tutor and student @p1", async ({ browser }) => {
    const before = await one<{ reserved: number }>(
      "SELECT reserved_minutes AS reserved FROM v_enrollment_balance WHERE enrollment_id = $1",
      [IDS.student1Enrollment],
    );
    // X-01 may have cancelled this month's lessons, so add a fresh one student1 is booked into.
    const upcoming = await scheduleLesson(await apiAs("tutor1"), { daysFromNow: 40, start: "08:00", end: "09:30" });
    expect(upcoming.added).toBeGreaterThan(0);
    const before2 = await one<{ reserved: number }>(
      "SELECT reserved_minutes AS reserved FROM v_enrollment_balance WHERE enrollment_id = $1",
      [IDS.student1Enrollment],
    );
    before.reserved = before2.reserved;
    const admin = await personOn(browser, "admin");
    await admin.goto(`${BO}/lessons`);
    await admin.locator("tbody tr").filter({ hasText: "08:00–09:30 WIB" }).getByRole("button", { name: "Cancel" }).click();
    await admin.getByLabel("Reason").fill("Exam week");
    await admin.getByRole("button", { name: "Cancel lesson" }).click();
    await expect(admin.getByText("Lesson cancelled")).toBeVisible();
    const cancelled = await one<{ status: string }>("SELECT status FROM lessons WHERE id = $1", [upcoming.lessonId]);
    expect(cancelled.status).toBe("cancelled");

    const tutor = await personOn(browser, "tutor1");
    await tutor.goto(`${APP}/tutor/classes/${IDS.mathClass}`);
    await expect(tutor.getByText("Cancelled: Exam week")).toBeVisible();

    const student = await personOn(browser, "student1");
    await student.goto(`${APP}/student/classes/${IDS.mathClass}`);
    await expect(student.getByText("Cancelled: Exam week")).toBeVisible();
    const after = await one<{ reserved: number }>(
      "SELECT reserved_minutes AS reserved FROM v_enrollment_balance WHERE enrollment_id = $1",
      [IDS.student1Enrollment],
    );
    expect(after.reserved).toBe(before.reserved - 90);
    await expect(student.getByText(`${h(after.reserved)} booked for upcoming lessons`)).toBeVisible();
  });
});
