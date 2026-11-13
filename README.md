# sg-e2e-test — end-to-end tests

Playwright tests across **sg-api**, **sg-app** (PWA) and **sg-backoffice**:
- real browsers: Desktop Chrome, Pixel 7 (Chromium) and iPhone 14 (WebKit)
- the real API and a real PostgreSQL database

The test cases are in [TEST_CASES.md](TEST_CASES.md), and what the sweep found is in [BUGS.md](BUGS.md).

## Setup

The three app repos ([sg-api](https://github.com/dimsurd/sg-api), [sg-app](https://github.com/dimsurd/sg-app), [sg-backoffice](https://github.com/dimsurd/sg-backoffice)) must sit next to this folder:

```
star-generation/
  sg-api/  sg-app/  sg-backoffice/  sg-e2e/
```

Requirements:
- PostgreSQL running locally. The suite creates and owns the `star_generation_e2e` database; change it with `E2E_DATABASE_URL`.
- Dependencies installed in each app repo (`pnpm install`).

```bash
pnpm install
pnpm exec playwright install chromium webkit
```

## Run

```bash
pnpm test          # build both frontends for e2e, then run everything
pnpm test:fast     # skip the build (refuses to run if the source changed since the last build)
pnpm test:p0       # build, then only the must-pass cases
pnpm report        # open the last HTML report (traces + screenshots of failures)
```

Each run starts its own copies of the apps, so your dev servers and dev data are never touched:

| | Port | Database |
|---|---|---|
| API | 4100 | `star_generation_e2e`, recreated each run |
| PWA | 3100 | Production build in `sg-app/.next-e2e` |
| Back office | 3101 | Production build in `sg-backoffice/.next-e2e` |

Other details:
- Each spec file resets the database to the seed, so specs are independent.
- Tests run serially (`workers: 1`) against one database.
- `retries: 0`: a flaky test is treated as a bug to investigate.

## Coverage

| Spec | Cases | Notes |
|---|---|---|
| `auth.spec.ts` | AUTH-01…14 | Role-separated sign-in, redirects, two sessions in one browser, tampered cookies |
| `student.spec.ts` | STU-01…16 | Pixel 7. Enroll → pay → access, full class, approved logbooks only, Buy package, Explore search + lazy loading |
| `home.spec.ts` | HOME-01…05 | Pixel 7. Home dashboards, featured carousel, nav, /student/browse redirect, profile sheet |
| `tutor.spec.ts` | TUT-01…17 | Pixel 7. WIB scheduling, overlap, logbook entries, submit, sent-back loop, earnings |
| `admin.spec.ts` | ADM-01…19 | Desktop. Dashboard maths, pay/undo/void, review + idempotent approve, class rules |
| `cross-app.spec.ts` | X-01…05 | Three people on three devices, one flow; the same numbers in every app |
| `security.spec.ts` | SEC-01…08 | 403/404 per role, unapproved text never reaches students, last-seat race, bad input |
| `timezone.spec.ts` | TZ-01…03 | Browsers in London and Los Angeles still see and store WIB |
| `pwa.spec.ts` | PWA-01…08 | Manifest/icons, service worker, `/api` never cached, offline, install on Android + iOS |
| `ui.spec.ts` | UI-01…06 | No sideways scroll or hidden content on phones, axe (WCAG 2 AA), keyboard, theme, dialog title vs ✕ |
| `resilience.spec.ts` | RES-01…03 | API down / 502, double clicks on money actions, slow API |

All 104 cases are automated: **107 tests**, because UI-01 and UI-06 run on several devices. Latest full run: **107 passed** (after fixing one test-timing issue in STU-16).
