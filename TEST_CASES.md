# E2E Test Cases — Star Generation

End-to-end tests across **sg-api**, **sg-app** (PWA) and **sg-backoffice**, driven by Playwright. The goal is to find bugs a person would hit, not to repeat the API unit tests. Each case goes through real browsers, the real API and a real PostgreSQL database.

## Test environment

| Piece | Port | Notes |
|---|---|---|
| sg-api | **4100** | Own database `star_generation_e2e`, so the dev database is never touched |
| sg-app | **3100** | Production build (`next build && next start`), so the service worker and install prompt behave like they would for real users |
| sg-backoffice | **3101** | Production build |

- Playwright's `webServer` starts all three. A `globalSetup` resets the e2e database (schema + seed).
- Each spec file resets the database again in `beforeAll`, so specs don't depend on each other.
- Test data is the seed. All passwords are `Password123!`.
  - Math Group A: capacity 2, Rp150,000/h for students, Rp100,000/h for the tutor, 12h packages
  - student1: paid 12h, with 6h used and 3h reserved
  - The logbook from two months ago is approved; last month's is submitted.
- Browsers and viewports:
  - **Desktop Chrome** for the back office
  - **Pixel 7** (Android Chrome) and **iPhone 14** (WebKit) for the PWA
- Times are checked in WIB, whatever the test machine's timezone: tests run with `timezoneId: 'Asia/Jakarta'`, and a separate project uses `Europe/London` to catch timezone bugs.

Priority: **P0** = must pass before submitting · **P1** = important · **P2** = nice to have.

---

## 1. Authentication & routing

| ID | Pri | Case | Steps | Expected |
|---|---|---|---|---|
| AUTH-01 | P0 | Admin signs in to the back office | Back office `/login` → admin credentials | Lands on Money dashboard; sidebar shows the admin's name |
| AUTH-02 | P0 | Wrong password | Back office login with a wrong password | Inline "Incorrect email or password"; stays on `/login`; no toast duplicate |
| AUTH-03 | P0 | Tutor/student blocked from back office | Back office login as tutor1 | Message "The back office is for admins only…"; no session cookie set |
| AUTH-04 | P0 | Admin blocked from the app | App login as admin | Message "Admins sign in through the back office." |
| AUTH-05 | P0 | Student signs in to the app | App login as student1 | Redirected to `/student` |
| AUTH-06 | P0 | Tutor signs in to the app | App login as tutor1 | Redirected to `/tutor` |
| AUTH-07 | P0 | Logged-out user is sent to login | Visit back office `/invoices` and app `/student` without a session | Redirected to `/login` (back office keeps `?next=/invoices`) |
| AUTH-08 | P1 | Role areas are separated | As student1, visit `/tutor/earnings` | Redirected to `/student`; tutor data never requested |
| AUTH-09 | P1 | `next` redirect after login | Visit back office `/logbooks` logged out → log in | Lands on `/logbooks` |
| AUTH-10 | P1 | Logout | Log out from each app | Back on `/login`; going back in history does not show data |
| AUTH-11 | P1 | Both apps signed in at once | Admin in back office + student in app, same browser | Both sessions work independently (separate cookies) |
| AUTH-12 | P1 | Expired / tampered session | Replace the session cookie with garbage, reload | API answers 401 → user lands on `/login` without a crash |
| AUTH-13 | P2 | Demo shortcuts on app login | Tap a demo account | Email filled, focus moves to password |

## 2. Student journey (PWA)

| ID | Pri | Case | Steps | Expected |
|---|---|---|---|---|
| STU-01 | P0 | Catalogue | student2 → Browse | Math Group A card: Grade 8 badge, Rp150,000/h, 12h package Rp1,800,000, "1 of 2 students" + "1 seat left" |
| STU-02 | P0 | Enroll | Enroll → confirm | Toast "You're enrolled"; redirected to Invoices; invoice INV-…: 12h × Rp150,000 = Rp1,800,000, Unpaid, due in 7 days |
| STU-03 | P0 | No access before paying | After STU-02, open My classes and `/student/classes/<id>` | My classes empty with "Pay to unlock" banner; class page shows an error/not found, never the schedule |
| STU-04 | P0 | Simulated payment | Invoices → Pay → Simulate payment | Toast "Payment received… added to 2 upcoming lesson(s)"; invoice Paid |
| STU-05 | P0 | Class unlocked after paying | My classes → Math Group A | 12h left of 12h; 3h booked; 2 upcoming lessons listed in WIB |
| STU-06 | P0 | Class full | student3 → Browse | Shows "Full", Enroll disabled |
| STU-07 | P0 | Approved logbooks only | student1 → class → Logbooks tab | Only the approved month is listed; the submitted month is not |
| STU-08 | P0 | Hours balance correct | student1 → My classes | 6h left of 12h, 6h used, 3h booked |
| STU-09 | P1 | Already enrolled state | student2 after enrolling, open Browse | Button "Pay to unlock" (unpaid) / "Open class" (paid) — no second Enroll |
| STU-10 | P1 | Low hours → Buy package | Make student1 low on hours (schedule lessons until ≤ 2h) → My classes | "Low hours" badge + "Buy package"; buying creates an unpaid invoice and the button changes to "Pay it" |
| STU-11 | P1 | Only one unpaid package | Try Buy package twice | Second attempt shows the API's message "already an unpaid package" |
| STU-12 | P1 | Cancelled lesson visible with reason | Tutor cancels an upcoming lesson → student schedule | Lesson struck through with the reason; booked hours go down by 1h30 |
| STU-13 | P1 | Lessons before joining are hidden | student2 (new) → class → Schedule | Past lessons from before enrolling don't appear |
| STU-14 | P2 | Skipped lesson explained | A lesson scheduled while student is out of hours | Shown as "Not included — not enough hours" |
| STU-15 | P1 | Search the catalogue | Load demo catalogue (17 classes) → search "osn smp friday", "CITRA", "chemistry" → Show all / ✕ | 3 matches with "3 of 17 classes"; tutor search case-insensitive (8); no-match message; clearing restores all 17 |

## 3. Tutor journey (PWA)

| ID | Pri | Case | Steps | Expected |
|---|---|---|---|---|
| TUT-01 | P0 | Teaching home | tutor1 → home | Upcoming lessons in WIB; Math Group A with active students |
| TUT-02 | P0 | Schedule a lesson | Class → date, 16:00–17:30 → Schedule | Toast "scheduled with N student(s)"; appears in Upcoming with the same WIB time |
| TUT-03 | P0 | End before start | Start 17:00, end 16:00 | Inline error, Schedule disabled |
| TUT-04 | P0 | Overlapping lesson | Schedule a lesson overlapping an existing one | Error "overlaps another lesson for the same tutor"; nothing created |
| TUT-05 | P0 | Never sees student rates | Visit all tutor pages + inspect every API response | No "150.000", `studentRate`, invoice amounts anywhere |
| TUT-06 | P0 | Write an entry for an ended lesson | Create a lesson that has ended (via API, current month) → Logbooks → month → fill 4 fields → Save | Entry saved; lesson shows "Logged" |
| TUT-07 | P0 | Can't log a lesson that hasn't ended | Open a month with an upcoming lesson | "You can write this entry once the lesson has ended" — no form |
| TUT-08 | P0 | Submit blocked until complete | Month with an unlogged lesson | Blockers listed; Submit disabled |
| TUT-09 | P0 | Submit month | Complete all entries → Finalise & submit | Status "Awaiting review"; form locked |
| TUT-10 | P0 | Cancel a lesson | Upcoming lesson → Cancel with a reason | Lesson marked cancelled; students' hours released |
| TUT-11 | P0 | Earnings: approved vs pending | tutor1 → Earnings | Approved Rp300,000 (2 × 1h30 × Rp100,000), Pending Rp300,000; per-lesson lines Rp150,000 |
| TUT-12 | P1 | Sent-back logbook loop | Admin requests changes → tutor home | "was sent back" card; month shows admin comment; edit + Resubmit works |
| TUT-13 | P1 | Approved month is read-only | Open the approved month | No Edit buttons; "Approved" alert |
| TUT-14 | P1 | Other tutor's class | tutor2 opens `/tutor/classes/<Math Group A id>` | Not found; no data leaked |
| TUT-15 | P1 | Validation on entry form | Save with empty fields | Field-level messages; nothing sent |
| TUT-16 | P2 | Skipped students reported | Schedule a lesson longer than a student's free hours | Toast lists the student as not added |

## 4. Admin journey (back office)

| ID | Pri | Case | Steps | Expected |
|---|---|---|---|---|
| ADM-01 | P0 | Dashboard KPIs | Open dashboard (seed) | Outstanding Rp0, margin rows for the 2 seeded months: delivered Rp450,000, margin Rp150,000 (33.3%) each |
| ADM-02 | P0 | Unpaid invoice appears | student2 enrolls → dashboard | Outstanding Rp1,800,000; invoice listed with "Not due" |
| ADM-03 | P0 | Mark paid with reference | Dashboard → Mark paid → reference | Toast; invoice gone from unpaid; student gets access in the app |
| ADM-04 | P0 | Undo blocked after hours used | Invoices → Paid → student1's invoice → Undo payment | Error "hours were already used…"; still Paid |
| ADM-05 | P0 | Undo allowed when unused | Pay student2 → Undo with reason | Back to Unpaid; history shows mark_paid + undo_paid with actor and reason |
| ADM-06 | P0 | Void releases seat | student2 enrolls (unpaid) → admin voids | Seat released: student3 can enroll |
| ADM-07 | P0 | Logbook earnings preview | Logbooks → last month | Two entries; preview 2 × Rp150,000 = Rp300,000 |
| ADM-08 | P0 | Request changes | Request changes with a comment | Status "Changes requested"; comment in history |
| ADM-09 | P0 | Approve (idempotent) | Approve → call approve again via API | First: "earnings recorded for 2 lesson(s)"; second: "already approved"; tutor earnings total unchanged |
| ADM-10 | P0 | Create class | Classes → New class (tutor2, rates, capacity 4) | Appears in list; tutor2 sees it in the app |
| ADM-11 | P0 | Capacity below seats | Edit Math Group A capacity to 1 while 2 seats taken | Error; capacity unchanged |
| ADM-12 | P1 | Rate change doesn't touch paid invoices | Change student rate to Rp200,000 | Existing invoices keep Rp150,000; next package uses Rp200,000 |
| ADM-13 | P1 | Tutor change with clash | Give tutor2 a lesson at the same time as Math Group A's upcoming one, then switch Math Group A to tutor2 | Error listing the clash; tutor unchanged |
| ADM-14 | P1 | Tutor change without clash | Switch to tutor2 | Upcoming lessons move to tutor2; past lessons/earnings stay with tutor1 |
| ADM-15 | P1 | Issue package from dashboard | Student low on hours → Issue package | Invoice created; button replaced by "Package invoice unpaid" |
| ADM-16 | P1 | Lessons page | Upcoming/Past tabs + class filter; cancel a lesson | Correct lists; cancelled lesson shows reason |
| ADM-17 | P1 | Students page | Open Students | Each student's hours used/booked/left matches the app |
| ADM-18 | P1 | Sidebar badge | One submitted logbook | Logbooks badge shows 1; disappears after approval |
| ADM-19 | P2 | Margin month filter | Pick a month | Table and total change accordingly |

## 5. Cross-app consistency (the same truth everywhere)

| ID | Pri | Case | Expected |
|---|---|---|---|
| X-01 | P0 | Full happy path: student2 enrolls → pays → tutor schedules → lesson ends → tutor logs and submits → admin approves | Each step is reflected in the other two apps without a manual refresh beyond navigation |
| X-02 | P0 | Hours agree | student's "left", tutor's "free to book", admin Students and Dashboard show consistent numbers for the same enrollment |
| X-03 | P0 | Earnings agree | Admin earnings preview = admin Tutor earnings = tutor's Earnings screen after approval |
| X-04 | P1 | Logbook appears for students only after approval | Before approval: student sees nothing new. After: month visible with all entries |
| X-05 | P1 | Cancellation propagates | Admin cancels a lesson → tutor list + student schedule show it cancelled; student booked hours drop |

## 6. Security & data visibility (API-level, via Playwright's request context)

| ID | Pri | Case | Expected |
|---|---|---|---|
| SEC-01 | P0 | Student calls `/student/classes/<id>/logbooks` before paying | 404 |
| SEC-02 | P0 | Student calls any `/admin/*` or `/tutor/*` endpoint | 403 |
| SEC-03 | P0 | Tutor calls `/admin/logbooks/<id>/approve` | 403 |
| SEC-04 | P0 | Student pays someone else's invoice | 404, invoice unchanged |
| SEC-05 | P0 | No unapproved logbook text anywhere in student responses | Crawl every student endpoint; the submitted month's topics never appear |
| SEC-06 | P1 | Session cookie is httpOnly + SameSite=Lax | `document.cookie` doesn't contain it |
| SEC-07 | P1 | Concurrent enrollment for the last seat | Two students click Enroll at the same time → exactly one succeeds |
| SEC-08 | P2 | Invalid ids / garbage input | 400 with a readable message, never a 500 |

## 7. Time zones (WIB)

| ID | Pri | Case | Expected |
|---|---|---|---|
| TZ-01 | P0 | Browser in `Europe/London`: tutor schedules 16:00–17:30 | Stored as 09:00 UTC; shown as 16:00–17:30 WIB in all three apps |
| TZ-02 | P1 | Lesson at 23:30–00:30 WIB on the last day of a month | Lands in that month's logbook (WIB month), not the next |
| TZ-03 | P2 | Dates in lists | Every date/time is labelled WIB or is a plain date |

## 8. PWA (production build)

| ID | Pri | Case | Expected |
|---|---|---|---|
| PWA-01 | P0 | Manifest is valid | `/manifest.webmanifest` has name, start_url, standalone, theme colour, 192/512 PNG icons that load |
| PWA-02 | P0 | Service worker registers and controls the page | `navigator.serviceWorker.controller` set after reload |
| PWA-03 | P0 | API is never cached | After visiting pages, no `/api/` entries in any Cache Storage |
| PWA-04 | P1 | Offline fallback | Go offline → navigate to an uncached page → offline page shown; offline banner visible |
| PWA-05 | P1 | Back online resumes | Reconnect → banner disappears, data loads |
| PWA-06 | P1 | Install button — Chromium/Android | Header "Install app" button: menu guide before Chrome offers a prompt, native prompt after; present on every screen |
| PWA-07 | P1 | Install guide — iOS | On iPhone (WebKit) device profile, Install opens the Share → Add to Home Screen guide |
| PWA-08 | P2 | Logout clears cached pages | After logout, page cache contains only `/offline` |

## 9. Responsive & accessibility smoke

| ID | Pri | Case | Expected |
|---|---|---|---|
| UI-01 | P1 | PWA on Pixel 7 and iPhone 14 | No horizontal scroll on any page; floating nav doesn't cover the last item of a list |
| UI-02 | P1 | Back office at 1280px and 768px | Sidebar on desktop; menu button + drawer on tablet; tables scroll inside their card |
| UI-03 | P1 | Axe scan (`@axe-core/playwright`) on main pages | No critical/serious violations |
| UI-04 | P2 | Keyboard | Login, dialogs (open, submit, Esc to close) usable with keyboard only |
| UI-05 | P2 | Theme | Primary buttons navy `#2F3F5F`, active nav gold `#F1C019`, font DM Sans |
| UI-06 | P1 | Dialog title vs close button | Open the Enroll dialog for a long class name (Pixel 7, iPhone) and the back office Edit class dialog | Title and ✕ bounding boxes never overlap |

## 10. Resilience

| ID | Pri | Case | Expected |
|---|---|---|---|
| RES-01 | P1 | API down | Pages show the "Couldn't load this / Try again" state, not a blank screen |
| RES-02 | P1 | Double-click on money buttons (Pay, Mark paid, Approve) | Exactly one effect (one payment, one approval, earnings once) |
| RES-03 | P2 | Slow API (route delayed 2s) | Loading skeletons/spinners; buttons disabled while pending |

---

**Total: 96 cases** (P0 = 49, P1 = 37, P2 = 10).

## Structure

```
sg-e2e/
  playwright.config.ts      projects: backoffice-desktop, app-android, app-iphone, tz-london; webServer starts api/app/backoffice
  global-setup.ts           builds apps if needed, resets the e2e database
  fixtures/                 login helpers per role, API client, db reset, time helpers
  tests/
    auth.spec.ts  student.spec.ts  tutor.spec.ts  admin.spec.ts
    cross-app.spec.ts  security.spec.ts  timezone.spec.ts  pwa.spec.ts  ui.spec.ts  resilience.spec.ts
  BUGS.md                   every bug found: case ID, steps, expected vs actual, fix commit
```

The three app repos are expected next to this folder (`../sg-api`, `../sg-app`, `../sg-backoffice`).
