import { expect, test, type Page } from "@playwright/test";
import { scheduleLesson } from "../fixtures/actions";
import { apiAs, login } from "../fixtures/auth";
import { one, q, resetDb } from "../fixtures/db";
import { BO, IDS } from "../fixtures/env";
import { idr } from "../fixtures/time";

test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

async function admin(page: Page, path = "/") {
  await login(page, "admin");
  await page.goto(`${BO}${path}`);
}

const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

let student2InvoiceNo = "";
let englishClassId = "";

test.describe("Admin journey", () => {
  test("ADM-01 dashboard numbers match the seed @p0", async ({ page }) => {
    await admin(page);
    await expect(page.locator('[data-slot="card"]').filter({ hasText: "Outstanding" })).toContainText(idr(0));
    const profitability = page.locator('[data-slot="card"]').filter({ hasText: "Class profitability" });
    const rows = profitability.locator("tbody tr").filter({ hasText: "Math Group A" });
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row).toContainText(idr(450000));
      await expect(row).toContainText(`${idr(150000)}(33.3%)`);
    }
  });

  test("ADM-07 + ADM-18 logbook review shows the earnings preview; sidebar badge @p0", async ({ page }) => {
    await admin(page, "/logbooks");
    await expect(page.getByRole("navigation").getByRole("link", { name: /Logbooks\s*1/ })).toBeVisible();
    await page.getByRole("link", { name: "Math Group A" }).first().click();
    await expect(page).toHaveURL(`${BO}/logbooks/${IDS.submittedLogbook}`);
    await expect(page.getByText("Angles and triangles")).toBeVisible();
    await expect(page.getByText("Pythagoras theorem")).toBeVisible();
    const preview = page.locator('[data-slot="card"]').filter({ hasText: "Tutor earnings" });
    await expect(preview.getByText(idr(150000), { exact: true })).toHaveCount(2);
    await expect(preview).toContainText(idr(300000));
  });

  test("ADM-08 request changes with a comment @p0", async ({ page }) => {
    await admin(page, `/logbooks/${IDS.submittedLogbook}`);
    await page.getByRole("button", { name: "Request changes" }).click();
    await page.getByLabel("What needs fixing?").fill("Lesson 2 doesn't mention the homework.");
    await page.getByRole("button", { name: "Send back" }).click();
    await expect(page.getByText("Sent back to the tutor with your comment")).toBeVisible();
    await expect(page.getByText("Changes requested").first()).toBeVisible();
    await expect(page.getByText("“Lesson 2 doesn't mention the homework.”")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("ADM-09 + ADM-18 approve is idempotent and clears the badge @p0", async ({ page }) => {
    const [{ m }] = await q<{ m: string }>("SELECT to_char(month,'YYYY-MM') AS m FROM logbooks WHERE id = $1", [IDS.submittedLogbook]);
    const tutor = await apiAs("tutor1");
    expect((await tutor.post(`/tutor/classes/${IDS.mathClass}/logbooks/${m}/submit`)).status()).toBe(200);

    await admin(page, `/logbooks/${IDS.submittedLogbook}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: `Approve · ${idr(300000)}` }).click();
    await expect(page.getByText("Approved · earnings recorded for 2 lesson(s)")).toBeVisible();
    await expect(page.getByText("Approved and read-only")).toBeVisible();

    const api = await apiAs("admin");
    const again = await (await api.post(`/admin/logbooks/${IDS.submittedLogbook}/approve`, { data: {} })).json();
    expect(again).toMatchObject({ alreadyApproved: true, earningsRecorded: 0 });
    const total = await one<{ s: number }>("SELECT sum(amount)::bigint AS s FROM tutor_earnings WHERE tutor_id = $1", [IDS.tutor1]);
    expect(total.s).toBe(600000);

    await page.reload();
    await expect(page.getByRole("navigation").getByRole("link", { name: /^Logbooks$/ })).toBeVisible();
  });

  test("ADM-02 a new unpaid invoice appears on the dashboard @p0", async ({ page }) => {
    const s2 = await apiAs("student2");
    const r = await (await s2.post("/student/enrollments", { data: { classId: IDS.mathClass } })).json();
    student2InvoiceNo = r.invoice.invoiceNo;
    await admin(page);
    await expect(page.locator('[data-slot="card"]').filter({ hasText: "Outstanding" })).toContainText(idr(1800000));
    const row = page.locator("tr").filter({ hasText: "Eka Wulandari" });
    await expect(row).toContainText(student2InvoiceNo);
    await expect(row).toContainText("Not due");
  });

  test("ADM-03 mark paid with a reference gives the student access @p0", async ({ page }) => {
    await admin(page);
    await page.locator("tr").filter({ hasText: "Eka Wulandari" }).getByRole("button", { name: "Mark paid" }).click();
    await page.getByLabel("Payment reference").fill("BCA transfer ref 0042");
    await page.getByRole("button", { name: "Mark as paid" }).click();
    await expect(page.getByText(`${student2InvoiceNo} marked as paid · added to 2 upcoming lesson(s)`)).toBeVisible();
    await expect(page.getByText("Everything is paid")).toBeVisible();
    const s2 = await apiAs("student2");
    expect((await (await s2.get("/student/classes")).json()).classes).toHaveLength(1);
  });

  test("ADM-04 undo is refused once hours were used @p0", async ({ page }) => {
    await admin(page, "/invoices");
    await page.getByRole("tab", { name: "Paid", exact: true }).click();
    const no = (await one<{ invoice_no: string }>("SELECT invoice_no FROM invoices WHERE id = $1", [IDS.student1Invoice])).invoice_no;
    await page.getByRole("button", { name: `More actions for ${no}` }).click();
    await page.getByRole("menuitem", { name: "Undo payment" }).click();
    await page.getByLabel("Reason").fill("Testing undo");
    await page.getByRole("button", { name: "Undo payment" }).click();
    await expect(page.getByText(/hours were already used/)).toBeVisible();
    const inv = await one<{ status: string }>("SELECT status FROM invoices WHERE id = $1", [IDS.student1Invoice]);
    expect(inv.status).toBe("paid");
  });

  test("ADM-05 undo works while no hours were used, with history @p0", async ({ page }) => {
    await admin(page, "/invoices");
    await page.getByRole("tab", { name: "Paid", exact: true }).click();
    await page.getByRole("button", { name: `More actions for ${student2InvoiceNo}` }).click();
    await page.getByRole("menuitem", { name: "Undo payment" }).click();
    await page.getByLabel("Reason").fill("Transfer bounced");
    await page.getByRole("button", { name: "Undo payment" }).click();
    await expect(page.getByText(`Payment on ${student2InvoiceNo} was undone`)).toBeVisible();

    await page.getByRole("tab", { name: "Unpaid", exact: true }).click();
    await page.getByRole("button", { name: `More actions for ${student2InvoiceNo}` }).click();
    await page.getByRole("menuitem", { name: "History" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Mark paid");
    await expect(dialog).toContainText("Undo paid");
    await expect(dialog).toContainText("Ayu Pratiwi (admin)");
    await expect(dialog).toContainText("“Transfer bounced”");
  });

  test("ADM-06 voiding an unpaid enrollment releases the seat @p0", async ({ page }) => {
    await admin(page, "/invoices");
    await page.getByRole("button", { name: `More actions for ${student2InvoiceNo}` }).click();
    await page.getByRole("menuitem", { name: "Void invoice" }).click();
    await page.getByLabel("Reason").fill("Student withdrew");
    await page.getByRole("button", { name: "Void invoice" }).click();
    await expect(page.getByText(`${student2InvoiceNo} voided · seat released`)).toBeVisible();
    const s3 = await apiAs("student3");
    expect((await s3.post("/student/enrollments", { data: { classId: IDS.mathClass } })).status()).toBe(201);
  });

  test("ADM-11 capacity can't drop below seats taken @p0", async ({ page }) => {
    await admin(page, "/classes");
    await page.locator("tr").filter({ hasText: "Math Group A" }).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Capacity").fill("1");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog").getByText(/Capacity cannot be lower than the 2 seat\(s\)/)).toBeVisible();
    expect((await one<{ capacity: number }>("SELECT capacity FROM classes WHERE id = $1", [IDS.mathClass])).capacity).toBe(2);
  });

  test("ADM-10 create a class for tutor2 @p0", async ({ page }) => {
    await admin(page, "/classes");
    await page.getByRole("button", { name: "New class" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Name").fill("English Group B");
    await d.getByLabel("Description").fill("Conversation practice for grade 8.");
    await d.getByRole("combobox", { name: "Tutor" }).click();
    await page.getByRole("option", { name: /Citra Lestari/ }).click();
    await d.getByLabel("Student rate / hour (Rp)").fill("120000");
    await d.getByLabel("Tutor rate / hour (Rp)").fill("80000");
    await d.getByLabel("Capacity").fill("4");
    await d.getByRole("button", { name: "Create class" }).click();
    await expect(page.getByText("Class created")).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "English Group B" })).toContainText("Citra Lestari");
    englishClassId = (await one<{ id: string }>("SELECT id FROM classes WHERE name = 'English Group B'")).id;
    const t2 = await apiAs("tutor2");
    const classes = (await (await t2.get("/tutor/classes")).json()).classes as { name: string }[];
    expect(classes.map((c) => c.name)).toContain("English Group B");
  });

  test("ADM-15 issue a package to a student running low @p1", async ({ page }) => {
    // student1 has 3h free to book; two more 90-minute lessons book it all.
    const tutor = await apiAs("tutor1");
    await scheduleLesson(tutor, { daysFromNow: 15, start: "10:00", end: "11:30" });
    await scheduleLesson(tutor, { daysFromNow: 16, start: "10:00", end: "11:30" });
    await admin(page);
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Running low on hours" });
    const item = card.locator("li").filter({ hasText: "Dimas Saputra" });
    await expect(item).toContainText("Low hours");
    await item.getByRole("button", { name: "Issue package" }).click();
    await expect(page.getByText(/INV-\d{4}-\d{4} issued to Dimas Saputra/)).toBeVisible();
    await expect(item).toContainText("Package invoice unpaid");
  });

  test("ADM-16 lessons page: tabs, filter and cancel @p1", async ({ page }) => {
    await admin(page, "/lessons");
    await expect(page.getByRole("tab", { name: "Upcoming", exact: true })).toHaveAttribute("data-state", "active");
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await page.getByRole("combobox", { name: "Class" }).click();
    await page.getByRole("option", { name: "English Group B" }).click();
    await expect(page.getByText("No upcoming lessons")).toBeVisible();
    await page.getByRole("combobox", { name: "Class" }).click();
    await page.getByRole("option", { name: "Math Group A" }).click();
    const row = rows.filter({ hasText: "10:00–11:30 WIB" }).last();
    await row.getByRole("button", { name: "Cancel" }).click();
    await page.getByLabel("Reason").fill("Public holiday");
    await page.getByRole("button", { name: "Cancel lesson" }).click();
    await expect(page.getByText("Lesson cancelled — students' hours were released")).toBeVisible();
    await expect(rows.filter({ hasText: "Public holiday" })).toHaveCount(1);
    await page.getByRole("tab", { name: "Past", exact: true }).click();
    await expect(rows.filter({ hasText: "Entry missing" }).or(rows.filter({ hasText: "Logged" })).first()).toBeVisible();
  });

  test("ADM-17 students page matches the balance view @p1", async ({ page }) => {
    const b = await one<{ used: number; reserved: number; remaining: number }>(
      `SELECT used_minutes AS used, reserved_minutes AS reserved, remaining_minutes AS remaining
         FROM v_enrollment_balance WHERE enrollment_id = $1`,
      [IDS.student1Enrollment],
    );
    const h = (m: number) => (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);
    await admin(page, "/students");
    const row = page.locator("tr").filter({ hasText: "Dimas Saputra" });
    await expect(row).toContainText(`${h(b.used)} used · ${h(b.reserved)} booked · 12h paid`);
    await expect(row).toContainText(h(b.remaining));
  });

  test("ADM-19 margin table filters by month @p2", async ({ page }) => {
    const [{ m }] = await q<{ m: string }>("SELECT to_char(month,'YYYY-MM') AS m FROM logbooks WHERE id = $1", [IDS.approvedLogbook]);
    await admin(page);
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Class profitability" });
    await card.getByRole("combobox", { name: "Month" }).click();
    await page.getByRole("option", { name: fmtMonth(m) }).click();
    const rows = card.locator("tbody tr").filter({ hasText: "Math Group A" });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(fmtMonth(m));
  });

  test("ADM-12 a rate change leaves existing invoices alone @p1", async ({ page }) => {
    await admin(page, "/classes");
    await page.locator("tr").filter({ hasText: "Math Group A" }).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Student rate / hour (Rp)").fill("200000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Class updated")).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "Math Group A" })).toContainText(idr(200000));

    const rates = await q<{ rate_per_hour: number }>(
      "SELECT rate_per_hour FROM invoices WHERE enrollment_id = $1 ORDER BY created_at",
      [IDS.student1Enrollment],
    );
    expect(rates.map((r) => r.rate_per_hour)).toEqual([150000, 150000]); // paid seed + ADM-15's package

    const api = await apiAs("admin");
    const unpaid = await one<{ id: string }>("SELECT id FROM invoices WHERE enrollment_id = $1 AND status = 'unpaid'", [
      IDS.student1Enrollment,
    ]);
    await api.post(`/admin/invoices/${unpaid.id}/void`, { data: { reason: "Reissue at new rate" } });
    const next = await (await api.post(`/admin/enrollments/${IDS.student1Enrollment}/packages`, { data: {} })).json();
    expect(next.invoice).toMatchObject({ ratePerHour: 200000, amount: 2_400_000 });
  });

  test("ADM-13 tutor change is refused when the new tutor has a clash @p1", async ({ page }) => {
    const up = await one<{ starts_at: Date; ends_at: Date }>("SELECT starts_at, ends_at FROM lessons WHERE id = $1", [
      IDS.upcomingLesson1,
    ]);
    const t2 = await apiAs("tutor2");
    const clash = await t2.post("/tutor/lessons", {
      data: { classId: englishClassId, startsAt: up.starts_at.toISOString(), endsAt: up.ends_at.toISOString() },
    });
    expect(clash.status()).toBe(201);

    await admin(page, "/classes");
    await page.locator("tr").filter({ hasText: "Math Group A" }).getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Tutor" }).click();
    await page.getByRole("option", { name: /Citra Lestari/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText("The new tutor already teaches at the same time");
    await expect(alert).toContainText("already teaching English Group B");
    const cls = await one<{ tutor_id: string }>("SELECT tutor_id FROM classes WHERE id = $1", [IDS.mathClass]);
    expect(cls.tutor_id).toBe(IDS.tutor1);
    await t2.post(`/tutor/lessons/${(await clash.json()).lessonId}/cancel`, { data: { reason: "Freeing the slot" } });
  });

  test("ADM-14 tutor change moves only upcoming lessons @p1", async ({ page }) => {
    const earningsBefore = await one<{ s: number }>("SELECT sum(amount)::bigint AS s FROM tutor_earnings WHERE tutor_id = $1", [IDS.tutor1]);
    await admin(page, "/classes");
    await page.locator("tr").filter({ hasText: "Math Group A" }).getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Tutor" }).click();
    await page.getByRole("option", { name: /Citra Lestari/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Class updated")).toBeVisible();

    const rows = await q<{ tutor_id: string; upcoming: boolean }>(
      "SELECT tutor_id, (starts_at > now()) AS upcoming FROM lessons WHERE class_id = $1 AND status = 'scheduled'",
      [IDS.mathClass],
    );
    for (const r of rows) expect(r.tutor_id).toBe(r.upcoming ? IDS.tutor2 : IDS.tutor1);
    const earningsAfter = await one<{ s: number }>("SELECT sum(amount)::bigint AS s FROM tutor_earnings WHERE tutor_id = $1", [IDS.tutor1]);
    expect(earningsAfter.s).toBe(earningsBefore.s);
  });
});
