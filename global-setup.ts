import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WATCHED = ["src", "public", "next.config.ts", "package.json"];

function newestMtime(p: string): number {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.mtimeMs;
  return Math.max(0, ...readdirSync(p).map((f) => newestMtime(path.join(p, f))));
}

/**
 * Refuse to test a stale build: if any frontend source is newer than its e2e
 * build, results would describe old code. Run `pnpm build:apps` (or `pnpm test`).
 */
export default function globalSetup() {
  for (const app of ["sg-app", "sg-backoffice"]) {
    const dir = path.join(ROOT, app);
    const buildId = path.join(dir, ".next-e2e", "BUILD_ID");
    if (!existsSync(buildId)) throw new Error(`${app} has no e2e build. Run: pnpm build:apps`);
    const built = statSync(buildId).mtimeMs;
    const changed = Math.max(...WATCHED.map((w) => newestMtime(path.join(dir, w))));
    if (changed > built) {
      throw new Error(`${app} changed after its e2e build (${new Date(changed).toISOString()}). Run: pnpm build:apps`);
    }
  }
}
