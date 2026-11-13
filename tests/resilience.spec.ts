import { expect, test, type Page } from "@playwright/test";
import { apiAs, login } from "../fixtures/auth";
import { one, q, resetDb } from "../fixtures/db";
import { APP, BO, IDS } from "../fixtures/env";
import { DESKTOP, PIXEL_7, idr } from "../fixtures/time";

test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

async function errorToasts(page: Page) {
  return page.locator('[data-sonner-toast][data-type="error"]').count();
}

test.describe("Resilience", () => {
  test("RES-01 API unreachable or failing: a clear error with a working retry @p1", async ({ browser }) => {
    for (const [origin, who, path, device, apiPrefix, ready] of [
      [APP, "student1", "/student", PIXEL_7, "**/api/student/**", "Math Group A"],
      [BO, "admin", "/invoices", DESKTOP, "**/api/admin/invoices**", "No unpaid invoices"],
    ] as const) {
      for (const failure of ["network", "502"] as const) {
        const ctx = await browser.newContext(device);
        const page = await ctx.newPage();
        await login(page, who);
        await page.route(apiPrefix, (route) =>
          failure === "network" ? route.abort("failed") : route.fulfill({ status: 502, body: "Bad Gateway" }),
        );
        await page.goto(`${origin}${path}`);
        const alert = page.getByRole("alert").filter({ hasText: "Couldn't load this" });
        await expect(alert, `${origin} ${failure}`).toBeVisible();
        // Human words, not a raw browser/HTTP error.
        await expect(alert, `${origin} ${failure}`).not.toContainText(/Failed to fetch|TypeError|Bad Gateway/);

        await page.unroute(apiPrefix);
        await alert.getByRole("button", { name: "Try again" }).click();
        await expect(page.getByText(ready).first()).toBeVisible();
        await expect(alert).toHaveCount(0);
        await ctx.close();
      }
    }
  });

  test("RES-02a double-clicking Pay pays once, without an error @p1", async ({ browser }) => {
    const s2 = await apiAs("student2");
    const { invoice } = await (await s2.post("/student/enrollments", { data: { classId: IDS.mathClass } })).json();
    const ctx = await browser.newContext(PIXEL_7);
    const page = await ctx.newPage();
    await login(page, "student2");
    await page.goto(`${APP}/student/invoices`);
    await page.getByRole("button", { name: `Pay ${idr(1800000)}` }).click();
    await page.getByRole("button", { name: "Simulate payment" }).dblclick();
    await expect(page.getByText("Payment received — thank you!")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await errorToasts(page)).toBe(0);
    const audits = await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'mark_paid'", [invoice.id]);
    expect(audits).toHaveLength(1);
    await ctx.close();
  });

  test("RES-02b double-clicking Mark paid records one payment @p1", async ({ browser }) => {
    // Undo student2's payment so it's unpaid again (no hours used yet).
    const inv = await one<{ id: string; invoice_no: string }>(
      "SELECT i.id, i.invoice_no FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id WHERE e.student_id = $1",
      [IDS.student2],
    );
    await (await apiAs("admin")).post(`/admin/invoices/${inv.id}/undo-paid`, { data: { reason: "Reset for test" } });

    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    await login(page, "admin");
    await page.goto(`${BO}/invoices`);
    await page.locator("tr").filter({ hasText: inv.invoice_no }).getByRole("button", { name: "Mark paid" }).click();
    await page.getByLabel("Payment reference").fill("BCA 9911");
    await page.getByRole("button", { name: "Mark as paid" }).dblclick();
    await expect(page.getByText(`${inv.invoice_no} marked as paid`)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await errorToasts(page)).toBe(0);
    const audits = await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'mark_paid'", [inv.id]);
    expect(audits).toHaveLength(2); // the student's earlier payment + this one
    await ctx.close();
  });

  test("RES-02c double-clicking Approve records earnings once @p1", async ({ browser }) => {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    await login(page, "admin");
    await page.goto(`${BO}/logbooks/${IDS.submittedLogbook}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: `Approve · ${idr(300000)}` }).dblclick();
    await expect(page.getByText(/Approved · earnings recorded for 2 lesson/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await errorToasts(page)).toBe(0);
    const total = await one<{ s: number }>("SELECT sum(amount)::bigint AS s FROM tutor_earnings WHERE tutor_id = $1", [IDS.tutor1]);
    expect(total.s).toBe(600000);
    const reviews = await q("SELECT 1 FROM logbook_reviews WHERE logbook_id = $1 AND action = 'approved'", [IDS.submittedLogbook]);
    expect(reviews).toHaveLength(1);
    await ctx.close();
  });

  test("RES-03 slow API: loading states and disabled buttons @p2", async ({ browser }) => {
    await resetDb();
    const ctx = await browser.newContext(PIXEL_7);
    const page = await ctx.newPage();
    await login(page, "student2");
    await (await apiAs("student2")).post("/student/enrollments", { data: { classId: IDS.mathClass } });

    const slow = async (route: import("@playwright/test").Route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    };
    await page.route("**/api/student/invoices", slow);
    await page.goto(`${APP}/student/invoices`);
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole("button", { name: `Pay ${idr(1800000)}` })).toBeVisible({ timeout: 5000 });

    await page.route("**/api/student/invoices/*/pay", slow);
    await page.getByRole("button", { name: `Pay ${idr(1800000)}` }).click();
    const confirm = page.getByRole("button", { name: "Simulate payment" });
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByText("Payment received — thank you!")).toBeVisible({ timeout: 6000 });
    await ctx.close();
  });
});
