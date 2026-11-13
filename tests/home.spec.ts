import { expect, test } from "@playwright/test";
import { apiAs, login } from "../fixtures/auth";
import { loadCatalog, resetDb } from "../fixtures/db";
import { APP, IDS } from "../fixtures/env";
import { PIXEL_7, idr } from "../fixtures/time";

test.use(PIXEL_7);
test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

test.describe("Home & navigation", () => {
  test("HOME-01 student Home: banner, stats, explore, nav @p1", async ({ page }) => {
    await login(page, "student1");
    await page.goto(`${APP}/student`);
    await expect(page.getByText("Hi, Dimas 👋")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Next up: Math Group A");
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary.getByRole("link").filter({ hasText: "Hours left" })).toContainText("6h");
    await expect(summary).toContainText("All paid");
    await expect(page.getByRole("list", { name: "Featured classes" })).toBeVisible();
    await expect(nav(page).getByRole("link")).toHaveText(["Home", "Explore", "My classes", "Invoices"]);
    await expect(nav(page).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await nav(page).getByRole("link", { name: "My classes" }).click();
    await expect(page).toHaveURL(`${APP}/student/classes`);
    await expect(page.getByRole("heading", { name: "My classes" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "My classes" })).toHaveAttribute("aria-current", "page");
  });

  test("HOME-02 a new student is pointed to the catalogue; unpaid shows on Home @p1", async ({ page }) => {
    await login(page, "student2");
    await page.goto(`${APP}/student/browse`);
    await expect(page).toHaveURL(`${APP}/student/explore`); // old link still works
    await page.goto(`${APP}/student`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find your first class");
    await expect(page.getByRole("link", { name: /Explore classes/ })).toHaveAttribute("href", "/student/explore");

    await (await apiAs("student2")).post("/student/enrollments", { data: { classId: IDS.mathClass } });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Almost there!");
    await expect(page.getByRole("link", { name: /Pay invoice/ })).toHaveAttribute("href", "/student/invoices");
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(idr(1800000));
  });

  test("HOME-03 tutor Home: banner, stats, nav @p1", async ({ page }) => {
    await login(page, "tutor1");
    await page.goto(`${APP}/tutor`);
    await expect(page.getByText("Hi, Budi 👋")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Next up: Math Group A");
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("Lessons this week");
    await expect(summary.getByRole("link").filter({ hasText: "Pending approval" })).toContainText(idr(300000));
    await expect(nav(page).getByRole("link")).toHaveText(["Home", "My classes", "Logbooks", "Earnings"]);
  });

  test("HOME-04 avatar opens a profile sheet with a friendly log out @p1", async ({ page }) => {
    await login(page, "student1");
    await page.goto(`${APP}/student`);
    await page.getByRole("button", { name: "Account" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Dimas Saputra" })).toBeVisible();
    await expect(sheet).toContainText("student1@stargeneration.test");
    await expect(sheet.getByText("student", { exact: true })).toBeVisible(); // role chip
    await expect(sheet).toContainText("See you next lesson");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Account" })).toBeFocused(); // focus returns to the avatar
    await page.getByRole("button", { name: "Account" }).click();
    await sheet.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(`${APP}/login`);
  });

  test("HOME-05 Home shows 3 equal-height featured classes in a swipeable row, then See all @p1", async ({ page }) => {
    await resetDb();
    await loadCatalog(); // 17 classes
    await login(page, "student3");
    await page.goto(`${APP}/student`);
    const row = page.getByRole("list", { name: "Featured classes" });
    await expect(row.locator('[data-slot="card"]')).toHaveCount(3); // not the whole catalogue
    await expect(row.getByRole("link", { name: /See all 17 classes/ })).toBeVisible();
    // Horizontal scroll: the row is wider than the screen and snaps card by card.
    const { scrollWidth, clientWidth, snap } = await row.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      snap: getComputedStyle(el).scrollSnapType,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    expect(snap).toContain("x");
    // Every card in the row is the same height, whatever the title length.
    const heights = await row.locator('[data-slot="card"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size, `card heights ${heights}`).toBe(1);
    await expect(page.getByRole("link", { name: "Explore all classes" })).toHaveCount(0); // "See all" is the CTA
    await page.getByRole("link", { name: "See all", exact: true }).click();
    await expect(page).toHaveURL(`${APP}/student/explore`);
  });
});
