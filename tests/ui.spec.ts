import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { login } from "../fixtures/auth";
import { loadCatalog, resetDb } from "../fixtures/db";
import { APP, BO, IDS, type Who } from "../fixtures/env";
import { DESKTOP, PIXEL_7 } from "../fixtures/time";

test.beforeAll(resetDb);

const APP_PAGES: [Who, string][] = [
  ["student1", "/student"],
  ["student1", "/student/classes"],
  ["student1", "/student/explore"],
  ["student1", "/student/invoices"],
  ["student1", `/student/classes/${IDS.mathClass}`],
  ["tutor1", "/tutor"],
  ["tutor1", `/tutor/classes/${IDS.mathClass}`],
  ["tutor1", "/tutor/logbooks"],
  ["tutor1", `/tutor/logbooks/${IDS.mathClass}/__APPROVED__`],
  ["tutor1", "/tutor/earnings"],
];
const BO_PAGES = ["/", "/classes", "/students", "/invoices", "/lessons", "/logbooks", `/logbooks/${IDS.submittedLogbook}`, "/earnings"];

let approvedMonth = "";
test.beforeAll(async () => {
  const { q } = await import("../fixtures/db");
  approvedMonth = (await q<{ m: string }>("SELECT to_char(month,'YYYY-MM') AS m FROM logbooks WHERE id = $1", [IDS.approvedLogbook]))[0]!.m;
});
const appPath = (p: string) => p.replace("__APPROVED__", approvedMonth);

async function checkMobileLayout(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: horizontal scroll`).toBeLessThanOrEqual(0);
  // The floating nav must not hide the end of the page.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const { lastBottom, navTop } = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const items = [...main.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && getComputedStyle(el).position !== "fixed";
    });
    const lastBottom = Math.max(...items.map((el) => el.getBoundingClientRect().bottom));
    const navTop = document.querySelector('nav[aria-label="Main"] ul')!.getBoundingClientRect().top;
    return { lastBottom, navTop };
  });
  expect(lastBottom, `${label}: content hidden behind the floating nav`).toBeLessThanOrEqual(navTop);
}

test.describe("Responsive & accessibility", () => {
  test.describe("PWA on Android", () => {
    test.use(PIXEL_7);
    test("UI-01 no horizontal scroll and nothing hidden under the nav (Pixel 7) @p1", async ({ page }) => {
      for (const [who, path] of APP_PAGES) {
        await page.context().clearCookies();
        await login(page, who);
        await page.goto(`${APP}${appPath(path)}`);
        await checkMobileLayout(page, path);
      }
    });
  });

  test("UI-01 no horizontal scroll and nothing hidden under the nav (iPhone 14) @p1 @ios", async ({ page }) => {
    for (const [who, path] of APP_PAGES) {
      await page.context().clearCookies();
      await login(page, who);
      await page.goto(`${APP}${appPath(path)}`);
      await checkMobileLayout(page, path);
    }
  });

  test("UI-02 back office layout at 1280px and 768px @p1", async ({ page }) => {
    await login(page, "admin");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BO}/`);
    await expect(page.locator("aside").getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Toggle menu" })).toBeHidden();

    await page.setViewportSize({ width: 768, height: 1024 });
    for (const p of BO_PAGES) {
      await page.goto(`${BO}${p}`);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${p}: page scrolls sideways at 768px`).toBeLessThanOrEqual(0);
    }
    await expect(page.locator("aside").first()).toBeHidden();
    await page.getByRole("button", { name: "Toggle menu" }).click();
    await page.getByRole("link", { name: "Invoices" }).click();
    await expect(page).toHaveURL(`${BO}/invoices`);
    await expect(page.getByRole("link", { name: "Classes" })).toBeHidden(); // drawer closed after navigating
  });

  test("UI-03 no serious or critical axe violations @p1", async ({ browser }) => {
    const results: string[] = [];
    const scan = async (page: Page, label: string) => {
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      for (const v of r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) {
        results.push(`${label} — ${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
      }
    };
    const app = await browser.newContext(PIXEL_7);
    const appPage = await app.newPage();
    await appPage.goto(`${APP}/login`);
    await scan(appPage, "app /login");
    for (const [who, path] of APP_PAGES) {
      await app.clearCookies();
      await login(appPage, who);
      await appPage.goto(`${APP}${appPath(path)}`);
      await scan(appPage, `app ${path}`);
    }
    const bo = await browser.newContext(DESKTOP);
    const boPage = await bo.newPage();
    await boPage.goto(`${BO}/login`);
    await scan(boPage, "bo /login");
    await login(boPage, "admin");
    for (const p of BO_PAGES) {
      await boPage.goto(`${BO}${p}`);
      await scan(boPage, `bo ${p}`);
    }
    expect(results, results.join("\n")).toEqual([]);
  });

  test("UI-04 keyboard only: sign in, open and close a dialog @p2", async ({ page }) => {
    await page.goto(`${BO}/login`);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.type("admin@stargeneration.test");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Password123!");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Money dashboard" })).toBeVisible();

    await page.goto(`${BO}/classes`);
    await page.getByRole("button", { name: "New class" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New class" })).toBeFocused(); // focus returns
  });

  test("UI-05 brand theme is applied @p2", async ({ browser }) => {
    const bo = await browser.newContext(DESKTOP);
    const page = await bo.newPage();
    await login(page, "admin");
    await page.goto(`${BO}/classes`);
    const btn = page.getByRole("button", { name: "New class" });
    await expect(btn).toHaveCSS("background-color", "rgb(47, 63, 95)"); // navy
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toMatch(/DM Sans|DM_Sans/);
    const cardRadius = await page.locator('[data-slot="card"]').first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(cardRadius).toBe("6px");

    const app = await browser.newContext(PIXEL_7);
    const appPage = await app.newPage();
    await login(appPage, "student1");
    await appPage.goto(`${APP}/student`);
    const active = appPage.locator('nav[aria-label="Main"] a[aria-current="page"]');
    await expect(active).toHaveCSS("background-color", "rgb(241, 192, 25)"); // gold
  });

  // ---------------------------------------------------------------- UI-06
  async function expectTitleClearOfClose(dialog: Locator) {
    const title = await dialog.getByRole("heading").first().boundingBox();
    const close = await dialog.getByRole("button", { name: "Close" }).boundingBox();
    expect(title && close).toBeTruthy();
    const overlaps =
      title!.x < close!.x + close!.width &&
      title!.x + title!.width > close!.x &&
      title!.y < close!.y + close!.height &&
      title!.y + title!.height > close!.y;
    expect(overlaps, `title ${JSON.stringify(title)} overlaps close ${JSON.stringify(close)}`).toBe(false);
  }

  async function openLongEnrollDialog(page: Page) {
    await resetDb();
    await loadCatalog();
    await login(page, "student3");
    await page.goto(`${APP}/student/browse`);
    await page.getByRole("searchbox", { name: "Search classes" }).fill("primary checkpoint science");
    await expect(page.getByText("1 class matches")).toBeVisible(); // wait for the server-side search
    await page.getByRole("button", { name: "Enroll" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toContainText("Cambridge Primary Checkpoint Science Grade 6");
    return dialog;
  }

  test.describe("Dialog close button (Pixel 7)", () => {
    test.use(PIXEL_7);
    test("UI-06 a long dialog title never runs under the close button @p1", async ({ page }) => {
      await expectTitleClearOfClose(await openLongEnrollDialog(page));
    });
  });

  test("UI-06 a long dialog title never runs under the close button (iPhone) @p1 @ios", async ({ page }) => {
    await expectTitleClearOfClose(await openLongEnrollDialog(page));
  });

  test("UI-06 back office dialogs keep the title clear too @p1", async ({ page }) => {
    await resetDb();
    await loadCatalog();
    await login(page, "admin");
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BO}/classes`);
    await page.locator("tr").filter({ hasText: "Cambridge Secondary Checkpoint English Grade 8" }).getByRole("button", { name: "Edit" }).click();
    await expectTitleClearOfClose(page.getByRole("dialog"));
  });
});
