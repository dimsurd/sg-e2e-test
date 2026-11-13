import { expect, test, type Page } from "@playwright/test";
import { login } from "../fixtures/auth";
import { resetDb } from "../fixtures/db";
import { APP } from "../fixtures/env";
import { PIXEL_7 } from "../fixtures/time";

test.beforeAll(resetDb);

/** All URLs stored in Cache Storage, grouped by cache name. */
const cachedUrls = (page: Page) =>
  page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => new URL(r.url).pathname);
    }
    return out;
  });

/** Wait until the service worker controls the page (first load installs it, reload makes it control). */
async function withServiceWorker(page: Page, path: string) {
  await page.goto(`${APP}${path}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** Chromium only fires beforeinstallprompt for real installs; tests dispatch a stand-in. */
async function fakeInstallPrompt(page: Page, outcome: "accepted" | "dismissed" = "accepted") {
  await page.evaluate((outcome) => {
    const e = new Event("beforeinstallprompt") as Event & Record<string, unknown>;
    (window as unknown as Record<string, number>).__promptCalls = 0;
    e.prompt = async () => {
      (window as unknown as Record<string, number>).__promptCalls! += 1;
    };
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  }, outcome);
}

test.describe("PWA (production build)", () => {
  test.use(PIXEL_7);

  test("PWA-01 manifest is valid and icons load @p0", async ({ request }) => {
    const res = await request.get(`${APP}/manifest.webmanifest`);
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: "Star Generation", start_url: "/", display: "standalone", theme_color: "#2F3F5F" });
    for (const size of [192, 512]) {
      const icon = m.icons.find((i: { sizes: string }) => i.sizes === `${size}x${size}`);
      expect(icon, `${size} icon`).toBeTruthy();
      const img = await request.get(`${APP}${icon.src}`);
      expect(img.headers()["content-type"]).toBe("image/png");
      const buf = await img.body();
      expect(buf.readUInt32BE(16), "PNG width").toBe(size);
      expect(buf.readUInt32BE(20), "PNG height").toBe(size);
    }
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  test("PWA-02 service worker registers and controls the page @p0", async ({ page }) => {
    await withServiceWorker(page, "/login");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${APP}/`);
  });

  test("PWA-03 API responses are never cached @p0", async ({ page }) => {
    await login(page, "student1");
    await withServiceWorker(page, "/student");
    for (const p of ["/student/browse", "/student/invoices", "/student"]) {
      await page.goto(`${APP}${p}`);
      await page.waitForLoadState("networkidle");
    }
    const caches = await cachedUrls(page);
    const all = Object.values(caches).flat();
    expect(all.length).toBeGreaterThan(0); // something is cached (static assets/pages)…
    expect(all.filter((u) => u.startsWith("/api/"))).toEqual([]); // …but never the API
  });

  test("PWA-04 + PWA-05 offline fallback and banner, then recovery @p1", async ({ page, context }) => {
    await login(page, "student1");
    await withServiceWorker(page, "/student");
    await expect(page.getByText("Math Group A")).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText("You're offline — we'll refresh as soon as you're back.")).toBeVisible();
    await page.goto(`${APP}/student/browse?never-cached=1`).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

    await context.setOffline(false);
    await page.goto(`${APP}/student`);
    await expect(page.getByText("Math Group A")).toBeVisible();
    await expect(page.getByText("You're offline — we'll refresh")).toHaveCount(0);
  });

  test("PWA-06 install button (Chromium/Android): menu guide, then native prompt @p1", async ({ page }) => {
    await login(page, "student1");
    await page.goto(`${APP}/student`);
    const install = page.getByRole("button", { name: "Install app" });

    // Android before Chrome offers a prompt: the button explains the browser-menu route.
    await expect(install).toBeVisible();
    await install.click();
    await expect(page.getByRole("dialog")).toContainText("Your browser installs apps from its menu.");
    await page.getByRole("button", { name: "Got it" }).click();

    // Once Chrome offers the prompt, the same button opens the native dialog.
    await fakeInstallPrompt(page);
    await install.click();
    await expect(page.getByText("Star Generation is on your home screen")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, number>).__promptCalls)).toBe(1);

    // Available on every screen, not only the home screen.
    await page.goto(`${APP}/student/invoices`);
    await expect(page.getByRole("button", { name: "Install app" })).toBeVisible();
  });

  test("PWA-08 logout clears cached pages @p2", async ({ page }) => {
    await login(page, "student1");
    await withServiceWorker(page, "/student");
    await page.goto(`${APP}/student/invoices`);
    await page.waitForLoadState("networkidle");
    const before = await cachedUrls(page);
    const pagesCache = Object.keys(before).find((k) => k.endsWith("-pages"))!;
    expect(before[pagesCache]!.length).toBeGreaterThan(1);

    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(`${APP}/login`);
    // Only public pages may remain (the login page is re-cached when the browser lands on it).
    await expect
      .poll(async () => ((await cachedUrls(page))[pagesCache] ?? []).filter((u) => u !== "/offline" && u !== "/login"))
      .toEqual([]);
  });
});

test.describe("PWA on iPhone", () => {
  test("PWA-07 iOS shows the Share → Add to Home Screen guide @p1 @ios", async ({ page }) => {
    await login(page, "student1");
    await page.goto(`${APP}/student`);
    await page.getByRole("button", { name: "Install app" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add to your home screen" })).toBeVisible();
    await expect(dialog).toContainText("Tap the Share button");
    await expect(dialog).toContainText("Add to Home Screen");
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
