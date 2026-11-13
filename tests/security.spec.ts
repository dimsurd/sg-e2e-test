import { expect, request, test } from "@playwright/test";
import { apiAs, login } from "../fixtures/auth";
import { one, resetDb } from "../fixtures/db";
import { API, APP, IDS } from "../fixtures/env";
import { PIXEL_7 } from "../fixtures/time";

test.describe.configure({ mode: "serial" });
test.beforeAll(resetDb);

test.describe("Security & data visibility", () => {
  test("SEC-01 unpaid students can't read a class's logbooks or schedule @p0", async () => {
    const s2 = await apiAs("student2");
    await s2.post("/student/enrollments", { data: { classId: IDS.mathClass } }); // enrolled, not paid
    expect((await s2.get(`/student/classes/${IDS.mathClass}/logbooks`)).status()).toBe(404);
    expect((await s2.get(`/student/classes/${IDS.mathClass}/schedule`)).status()).toBe(404);
  });

  test("SEC-02 students get 403 on every admin and tutor endpoint @p0", async () => {
    const s1 = await apiAs("student1");
    const paths = [
      "/admin/classes",
      "/admin/students",
      "/admin/invoices",
      "/admin/lessons",
      "/admin/logbooks",
      "/admin/earnings",
      "/admin/reports/overview",
      "/tutor/classes",
      "/tutor/lessons",
      "/tutor/logbooks",
      "/tutor/earnings",
    ];
    for (const p of paths) expect((await s1.get(p)).status(), p).toBe(403);
    expect((await s1.post(`/admin/invoices/${IDS.student1Invoice}/mark-paid`, { data: { paymentReference: "xxx" } })).status()).toBe(403);
  });

  test("SEC-03 tutors can't approve logbooks or touch invoices @p0", async () => {
    const t1 = await apiAs("tutor1");
    expect((await t1.post(`/admin/logbooks/${IDS.submittedLogbook}/approve`, { data: {} })).status()).toBe(403);
    expect((await t1.get("/admin/invoices")).status()).toBe(403);
    const lb = await one<{ status: string }>("SELECT status FROM logbooks WHERE id = $1", [IDS.submittedLogbook]);
    expect(lb.status).toBe("submitted");
  });

  test("SEC-04 a student can't pay someone else's invoice @p0", async () => {
    const s2 = await apiAs("student2");
    const s1 = await apiAs("student1");
    const own = (await (await s2.get("/student/invoices")).json()).invoices[0];
    const res = await s1.post(`/student/invoices/${own.id}/pay`);
    expect(res.status()).toBe(404);
    const inv = await one<{ status: string }>("SELECT status FROM invoices WHERE id = $1", [own.id]);
    expect(inv.status).toBe("unpaid");
  });

  test("SEC-05 unapproved logbook text never reaches a student @p0", async () => {
    const s1 = await apiAs("student1");
    const urls = [
      "/student/classes/available",
      "/student/classes",
      "/student/invoices",
      `/student/classes/${IDS.mathClass}/schedule`,
      `/student/classes/${IDS.mathClass}/logbooks`,
    ];
    const secret = /Angles and triangles|Pythagoras|hypotenuse|two-column proofs/i;
    for (const u of urls) {
      const body = await (await s1.get(u)).text();
      expect(body, u).not.toMatch(secret);
    }
    // …and the approved month is there.
    expect(await (await s1.get(`/student/classes/${IDS.mathClass}/logbooks`)).text()).toContain("Linear equations");
  });

  test("SEC-06 session cookie is httpOnly and SameSite=Lax @p1", async ({ browser }) => {
    const ctx = await browser.newContext(PIXEL_7);
    const page = await ctx.newPage();
    await login(page, "student1");
    await page.goto(`${APP}/student`);
    const cookie = (await ctx.cookies()).find((c) => c.name === "sg_app_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("sg_app_session");
    await ctx.close();
  });

  test("SEC-07 two students racing for the last seat: exactly one wins @p1", async ({ browser }) => {
    await resetDb();
    const pages = await Promise.all(
      (["student2", "student3"] as const).map(async (who) => {
        const ctx = await browser.newContext(PIXEL_7);
        const page = await ctx.newPage();
        await login(page, who);
        await page.goto(`${APP}/student/browse`);
        await page.getByRole("button", { name: "Enroll" }).click();
        return page;
      }),
    );
    await Promise.all(pages.map((p) => p.getByRole("button", { name: "Enroll & get invoice" }).click()));
    const outcomes = await Promise.all(
      pages.map((p) =>
        Promise.race([
          p.waitForURL(`${APP}/student/invoices`).then(() => "enrolled"),
          p.getByText("This class is full").waitFor().then(() => "full"),
        ]),
      ),
    );
    expect(outcomes.sort()).toEqual(["enrolled", "full"]);
    const seats = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM enrollments WHERE class_id = $1 AND status <> 'cancelled'",
      [IDS.mathClass],
    );
    expect(seats.n).toBe(2);
  });

  test("SEC-08 garbage input gets a readable 400, never a 500 @p2", async () => {
    const a = await apiAs("admin");
    const s = await apiAs("student1");
    const t = await apiAs("tutor1");
    const cases: [string, Promise<Awaited<ReturnType<typeof a.get>>>][] = [
      ["bad uuid in path", a.get("/admin/classes/not-a-uuid")],
      ["bad uuid in body", s.post("/student/enrollments", { data: { classId: "x" } })],
      ["negative capacity", a.post("/admin/classes", { data: { name: "X", tutorId: IDS.tutor1, studentRatePerHour: 1, tutorRatePerHour: 1, capacity: -1 } })],
      ["fractional rupiah", a.post("/admin/classes", { data: { name: "X", tutorId: IDS.tutor1, studentRatePerHour: 1.5, tutorRatePerHour: 1, capacity: 1 } })],
      ["bad month", t.get(`/tutor/classes/${IDS.mathClass}/logbooks/2026-13`)],
      ["time without offset", t.post("/tutor/lessons", { data: { classId: IDS.mathClass, startsAt: "2027-01-01T10:00:00", endsAt: "2027-01-01T11:00:00" } })],
      ["student id as tutor", a.post("/admin/classes", { data: { name: "X", tutorId: IDS.student1, studentRatePerHour: 1, tutorRatePerHour: 1, capacity: 1 } })],
    ];
    for (const [name, p] of cases) {
      const res = await p;
      expect(res.status(), name).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message, name).toBeTruthy();
    }

    // Malformed JSON body.
    const raw = await request.newContext({ baseURL: API });
    const res = await raw.post("/auth/login", {
      headers: { "content-type": "application/json", "x-sg-client": "app" },
      data: "{not json",
    });
    expect(res.status(), "malformed JSON").toBe(400);
  });
});
