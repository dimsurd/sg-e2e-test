import { expect, test, type Page } from "@playwright/test";
import { scheduleLesson } from "../fixtures/actions";
import { apiAs, login } from "../fixtures/auth";
import { loadCatalog, one, resetDb } from "../fixtures/db";
import { APP, IDS } from "../fixtures/env";
import { PIXEL_7, idr } from "../fixtures/time";

test.use(PIXEL_7);
test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

const classUrl = `${APP}/student/classes/${IDS.mathClass}`;

async function as(page: Page, who: "student1" | "student2" | "student3", path = "/student") {
  await page.context().clearCookies();
  await login(page, who);
  await page.goto(`${APP}${path}`);
}

test.describe("Student journey", () => {
  test("STU-01 catalogue shows price, package and seats @p0", async ({ page }) => {
    await as(page, "student2", "/student/browse");
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(card).toContainText(`${idr(150000)} / hour`);
    await expect(card).toContainText("12h package");
    await expect(card).toContainText(idr(1800000));
    await expect(card).toContainText("Grade 8"); // level badge derived from the class
    await expect(card).toContainText("1 of 2 students");
    await expect(card).toContainText("1 seat left");
  });

  test("STU-02 enrolling holds the seat and creates the package invoice @p0", async ({ page }) => {
    await as(page, "student2", "/student/browse");
    await page.getByRole("button", { name: "Enroll" }).click();
    await page.getByRole("button", { name: "Enroll & get invoice" }).click();
    await expect(page.getByText("You're enrolled — your seat is held")).toBeVisible();
    await expect(page).toHaveURL(`${APP}/student/invoices`);
    const inv = page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(inv).toContainText(/INV-\d{4}-0002/);
    await expect(inv).toContainText(`12h × ${idr(150000)}`);
    await expect(inv).toContainText(idr(1800000));
    await expect(inv).toContainText("Unpaid");
    const due = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }).format(
      new Date(Date.now() + 7 * 86_400_000),
    );
    await expect(inv).toContainText(`Due ${due}`);
  });

  test("STU-09a enrolled-but-unpaid shows 'Pay to unlock' instead of Enroll @p1", async ({ page }) => {
    await as(page, "student2", "/student/browse");
    await expect(page.getByRole("link", { name: "Pay to unlock" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enroll" })).toHaveCount(0);
  });

  test("STU-03 nothing is accessible before paying @p0", async ({ page }) => {
    await as(page, "student2", "/student/classes");
    await expect(page.getByText("No paid classes yet")).toBeVisible();
    await expect(page.getByText("1 invoice to pay")).toBeVisible();
    await page.goto(classUrl);
    await expect(page.getByText("Class not found")).toBeVisible();
    await expect(page.getByText("16:00–17:30 WIB")).toHaveCount(0);
  });

  test("STU-06 the class is full for the next student @p0", async ({ page }) => {
    await as(page, "student3", "/student/browse");
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(card).toContainText("Full");
    await expect(card.getByRole("button", { name: "Class is full" })).toBeDisabled();
  });

  test("STU-04 simulated payment @p0", async ({ page }) => {
    await as(page, "student2", "/student/invoices");
    await page.getByRole("button", { name: `Pay ${idr(1800000)}` }).click();
    await page.getByRole("button", { name: "Simulate payment" }).click();
    await expect(page.getByText("Payment received — thank you!")).toBeVisible();
    await expect(page.getByText("You've been added to 2 upcoming lesson(s).")).toBeVisible();
    await expect(page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" })).toContainText("Paid");
  });

  test("STU-05 the class unlocks with the right hours @p0", async ({ page }) => {
    await as(page, "student2", "/student/classes");
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(card).toContainText("12h");
    await expect(card).toContainText("left of 12h");
    await expect(card).toContainText("0h used · 3h booked for upcoming lessons");
    await page.goto(classUrl);
    await expect(page.getByText(/16:00–17:30 WIB/)).toHaveCount(2);
  });

  test("STU-09b paid shows 'Open class' @p1", async ({ page }) => {
    await as(page, "student2", "/student/browse");
    await expect(page.getByRole("link", { name: "Open class" })).toBeVisible();
  });

  test("STU-13 lessons from before enrolling are not shown @p1", async ({ page }) => {
    await as(page, "student2", `/student/classes/${IDS.mathClass}`);
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Past" })).toHaveCount(0);
  });

  test("STU-07 only approved logbooks are visible @p0", async ({ page }) => {
    await as(page, "student1", `/student/classes/${IDS.mathClass}`);
    await page.getByRole("tab", { name: /Logbooks/ }).click();
    await expect(page.getByText("Linear equations")).toBeVisible(); // approved month
    await expect(page.getByText("Angles and triangles")).toHaveCount(0); // submitted month
    await expect(page.getByRole("tab", { name: "Logbooks (1)" })).toBeVisible();
  });

  test("STU-08 student1's balance matches the seed @p0", async ({ page }) => {
    await as(page, "student1", "/student/classes");
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(card).toContainText("6h");
    await expect(card).toContainText("left of 12h");
    await expect(card).toContainText("6h used · 3h booked for upcoming lessons");
  });

  test("STU-12 a cancelled lesson shows with its reason and frees hours @p1", async ({ page }) => {
    const tutor = await apiAs("tutor1");
    const res = await tutor.post(`/tutor/lessons/${IDS.upcomingLesson1}/cancel`, { data: { reason: "Tutor is sick" } });
    expect(res.status()).toBe(200);
    await as(page, "student1", `/student/classes/${IDS.mathClass}`);
    await expect(page.getByText("Cancelled: Tutor is sick")).toBeVisible();
    await page.goto(`${APP}/student/classes`);
    await expect(page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" })).toContainText(
      "6h used · 1h 30m booked for upcoming lessons",
    );
  });

  test("STU-10 low on hours → Buy package creates an invoice @p1", async ({ page }) => {
    // student1 now has 4h 30m free to book: three 90-minute lessons use it all up.
    const tutor = await apiAs("tutor1");
    for (const d of [20, 21, 22]) await scheduleLesson(tutor, { daysFromNow: d, start: "10:00", end: "11:30" });

    await as(page, "student1", "/student/classes");
    const card = page.locator('[data-slot="card"]').filter({ hasText: "Math Group A" });
    await expect(card).toContainText("Low hours");
    await card.getByRole("button", { name: "Buy package" }).click();
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page).toHaveURL(`${APP}/student/invoices`);
    await expect(page.getByRole("button", { name: `Pay ${idr(1800000)}` })).toBeVisible();

    await page.goto(`${APP}/student/classes`);
    await expect(page.getByText("Your new package invoice is waiting.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buy package" })).toHaveCount(0);
  });

  test("STU-11 only one unpaid package at a time @p1", async ({ page }) => {
    await as(page, "student1");
    const res = await page.request.post(`${APP}/api/student/enrollments/${IDS.student1Enrollment}/packages`, {
      headers: { "x-sg-client": "app" },
      data: {},
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.message).toContain("already an unpaid package");
  });

  test("STU-14 a lesson scheduled while out of hours is explained @p2", async ({ page }) => {
    const tutor = await apiAs("tutor1");
    const { lessonId } = await scheduleLesson(tutor, { daysFromNow: 25, start: "10:00", end: "11:30" });
    const row = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM lesson_participants WHERE lesson_id = $1 AND enrollment_id = $2",
      [lessonId, IDS.student1Enrollment],
    );
    expect(row.n).toBe(0);
    await as(page, "student1", `/student/classes/${IDS.mathClass}`);
    await expect(page.getByText("Not included — not enough hours when it was scheduled")).toBeVisible();
  });

  test("STU-15 Explore: server-side search and lazy loading @p1", async ({ page }) => {
    await loadCatalog(); // 17 classes
    await as(page, "student3", "/student/explore");
    const list = page.getByRole("region", { name: "Class catalogue" });
    const cards = list.locator('[data-slot="card"]');
    await expect(page.getByText("17 classes", { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(10); // first page only

    // Scrolling to the end loads the rest.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(cards).toHaveCount(17);
    await expect(page.getByText("You've seen all 17 classes")).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search classes" });
    await search.fill("osn smp friday"); // every word, any order, matched by the API
    await expect(page.getByText("3 classes match “osn smp friday”")).toBeVisible();
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) await expect(card).toContainText(/OSN.*SMP/);

    await search.fill("CITRA"); // tutor name, case-insensitive
    await expect(cards).toHaveCount(8);

    await search.fill("chemistry");
    await expect(page.getByText("No classes match “chemistry”")).toBeVisible();
    await page.getByRole("button", { name: "Show all classes" }).click();
    await expect(page.getByText("17 classes", { exact: true })).toBeVisible();
    await search.fill("osn");
    await page.getByRole("button", { name: "Clear search" }).click(); // the ✕ in the box
    await expect(search).toHaveValue("");
  });

  test("STU-16 invoice status filters with counts @p2", async ({ page }) => {
    await as(page, "student1", "/student/invoices");
    const filters = page.getByRole("group", { name: "Filter invoices" });
    const cards = page.locator("ul").locator('[data-slot="card"]');
    await expect(cards.first()).toBeVisible(); // wait for the list before counting
    const all = await cards.count();
    await expect(filters.getByRole("button", { name: /^All/ })).toContainText(String(all));
    await filters.getByRole("button", { name: /^Paid/ }).click();
    await expect(filters.getByRole("button", { name: /^Paid/ })).toHaveAttribute("aria-pressed", "true");
    for (const card of await cards.all()) await expect(card).toContainText("Paid");
    await filters.getByRole("button", { name: /^Unpaid/ }).click();
    for (const card of await cards.all()) await expect(card.getByRole("button", { name: /^Pay / })).toBeVisible();
  });
});
