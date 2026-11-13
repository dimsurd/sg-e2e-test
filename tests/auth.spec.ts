import { expect, test } from "@playwright/test";
import { login, uiLogin } from "../fixtures/auth";
import { resetDb } from "../fixtures/db";
import { APP, BO, email } from "../fixtures/env";

test.beforeAll(resetDb);

test.describe("Authentication & routing", () => {
  test("AUTH-01 admin signs in to the back office @p0", async ({ page }) => {
    await uiLogin(page, "admin");
    await expect(page).toHaveURL(`${BO}/`);
    await expect(page.getByRole("heading", { name: "Money dashboard" })).toBeVisible();
    await expect(page.getByText("Ayu Pratiwi")).toBeVisible();
  });

  test("AUTH-02 wrong password shows one inline error @p0", async ({ page }) => {
    await uiLogin(page, "admin", "wrong-password");
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // Inline only — not duplicated as a toast.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  test("AUTH-03 tutors are refused by the back office @p0", async ({ page, context }) => {
    await uiLogin(page, email("tutor1"), undefined, BO);
    await expect(page.getByText("The back office is for admins only")).toBeVisible();
    expect((await context.cookies()).find((c) => c.name === "sg_bo_session")).toBeUndefined();
  });

  test("AUTH-04 admins are refused by the app @p0", async ({ page }) => {
    await uiLogin(page, email("admin"), undefined, APP);
    await expect(page.getByText("Admins sign in through the back office.")).toBeVisible();
  });

  test("AUTH-05 student lands on /student @p0", async ({ page }) => {
    await uiLogin(page, "student1");
    await expect(page).toHaveURL(`${APP}/student`);
    await expect(page.getByRole("heading", { name: "My classes" })).toBeVisible();
  });

  test("AUTH-06 tutor lands on /tutor @p0", async ({ page }) => {
    await uiLogin(page, "tutor1");
    await expect(page).toHaveURL(`${APP}/tutor`);
    await expect(page.getByRole("heading", { name: "Teaching" })).toBeVisible();
  });

  test("AUTH-07 logged-out users are sent to login @p0", async ({ page }) => {
    await page.goto(`${BO}/invoices`);
    await expect(page).toHaveURL(`${BO}/login?next=%2Finvoices`);
    await page.goto(`${APP}/student`);
    await expect(page).toHaveURL(`${APP}/login`);
  });

  test("AUTH-08 students can't open tutor pages @p1", async ({ page }) => {
    await login(page, "student1");
    const tutorCalls: string[] = [];
    page.on("request", (r) => r.url().includes("/api/tutor/") && tutorCalls.push(r.url()));
    await page.goto(`${APP}/tutor/earnings`);
    await expect(page).toHaveURL(`${APP}/student`);
    expect(tutorCalls).toEqual([]);
  });

  test("AUTH-09 back office returns to the requested page after login @p1", async ({ page }) => {
    await page.goto(`${BO}/logbooks`);
    await page.getByLabel("Email").fill(email("admin"));
    await page.getByLabel("Password").fill("Password123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${BO}/logbooks`);
    await expect(page.getByRole("heading", { name: "Logbooks" })).toBeVisible();
  });

  test("AUTH-10 logout ends the session in both apps @p1", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BO}/`);
    await expect(page.getByRole("heading", { name: "Money dashboard" })).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(`${BO}/login`);
    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/login/);

    await login(page, "student1");
    await page.goto(`${APP}/student`);
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(`${APP}/login`);
    await page.goto(`${APP}/student`);
    await expect(page).toHaveURL(`${APP}/login`);
  });

  test("AUTH-11 admin and student sessions coexist in one browser @p1", async ({ context }) => {
    await login(context, "admin");
    await login(context, "student1");
    const bo = await context.newPage();
    const app = await context.newPage();
    await bo.goto(`${BO}/`);
    await app.goto(`${APP}/student`);
    await expect(bo.getByText("Ayu Pratiwi")).toBeVisible();
    await expect(app.getByText("Math Group A")).toBeVisible();
  });

  test("AUTH-12 a tampered session cookie leads back to login without a crash @p1", async ({ page, context }) => {
    await context.addCookies([
      { name: "sg_bo_session", value: "garbage.token.value", domain: "localhost", path: "/" },
      { name: "sg_app_session", value: "garbage.token.value", domain: "localhost", path: "/" },
    ]);
    await page.goto(`${BO}/invoices`);
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`${APP}/student`);
    await expect(page).toHaveURL(`${APP}/login`);
  });

  test("AUTH-13 demo shortcuts fill the email @p2", async ({ page }) => {
    await page.goto(`${APP}/login`);
    await page.getByRole("button", { name: /student1@stargeneration\.test/ }).click();
    await expect(page.getByLabel("Email")).toHaveValue(email("student1"));
    await expect(page.getByLabel("Password")).toBeFocused();
  });
});
