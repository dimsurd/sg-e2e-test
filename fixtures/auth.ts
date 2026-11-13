import { expect, request, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { API, APP, BO, PASSWORD, email, type Who } from "./env";

const clientOf = (who: Who) => (who === "admin" ? "backoffice" : "app");
const originOf = (who: Who) => (who === "admin" ? BO : APP);

/** Fast login: posts through the frontend's /api proxy so the cookie lands in this browser context. */
export async function login(target: Page | BrowserContext, who: Who) {
  const req = "request" in target ? target.request : (target as BrowserContext).request;
  const res = await req.post(`${originOf(who)}/api/auth/login`, {
    headers: { "x-sg-client": clientOf(who) },
    data: { email: email(who), password: PASSWORD },
  });
  expect(res.status(), `login ${who}`).toBe(200);
}

/** Login through the real UI (used by the auth specs). */
export async function uiLogin(page: Page, who: Who | string, password = PASSWORD, origin?: string) {
  const isWho = !who.includes("@");
  const addr = isWho ? email(who as Who) : who;
  await page.goto(`${origin ?? (isWho ? originOf(who as Who) : APP)}/login`);
  await page.getByLabel("Email").fill(addr);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A logged-in API client straight to the Express API (for API-level and setup steps). */
export async function apiAs(who: Who): Promise<APIRequestContext> {
  const ctx = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { "x-sg-client": clientOf(who) },
  });
  const res = await ctx.post("/auth/login", { data: { email: email(who), password: PASSWORD } });
  expect(res.status(), `api login ${who}`).toBe(200);
  return ctx;
}
