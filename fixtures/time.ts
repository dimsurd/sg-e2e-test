import { devices } from "@playwright/test";

const WIB_OFFSET_MS = 7 * 3_600_000;

/** Wall-clock parts of a Date in WIB. */
export function wibParts(d: Date) {
  const w = new Date(d.getTime() + WIB_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`,
    month: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}`,
    time: `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`,
  };
}

/** ISO string with +07:00 for a WIB date (YYYY-MM-DD) and time (HH:MM). */
export const wibIso = (date: string, time: string) => `${date}T${time}:00+07:00`;

/** A WIB date N days from today. */
export const wibDate = (daysFromNow: number) => wibParts(new Date(Date.now() + daysFromNow * 86_400_000)).date;

/**
 * Times for a lesson that has already ended *in the current WIB month*:
 * 90 minutes ending 30 minutes ago, clamped to the start of the month.
 */
export function endedLessonThisMonth() {
  const now = Date.now();
  const nowWib = wibParts(new Date(now));
  const monthStartUtc = Date.parse(`${nowWib.month}-01T00:00:00+07:00`);
  const end = Math.max(now - 30 * 60_000, monthStartUtc + 60 * 60_000);
  const start = Math.max(end - 90 * 60_000, monthStartUtc);
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), month: nowWib.month };
}

/**
 * A 60-minute slot that ended at least 15 minutes ago, on 15-minute boundaries
 * (the time inputs use step=900), on today's WIB date. Null early in the WIB day.
 */
export function endedSlotToday(): { date: string; start: string; end: string } | null {
  const q = 15 * 60_000;
  const end = Math.floor((Date.now() - q) / q) * q;
  const start = end - 60 * 60_000;
  const s = wibParts(new Date(start));
  const e = wibParts(new Date(end));
  const today = wibParts(new Date()).date;
  if (s.date !== today || e.date !== today) return null;
  return { date: today, start: s.time, end: e.time };
}

/**
 * Device profiles usable in `test.use()` inside the chromium project
 * (defaultBrowserType can't be changed per describe block).
 */
function withoutBrowser<T extends { defaultBrowserType?: string }>(d: T) {
  const { defaultBrowserType: _ignored, ...rest } = d;
  return rest;
}
export const PIXEL_7 = withoutBrowser(devices["Pixel 7"]);
export const DESKTOP = withoutBrowser(devices["Desktop Chrome"]);

/** "1.800.000" style IDR as rendered by Intl id-ID (with a non-breaking space after Rp). */
export const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
