#!/usr/bin/env node
// Builds sg-app and sg-backoffice for e2e into .next-e2e, one after the other,
// with the e2e API URL baked into their /api rewrite.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = { ...process.env, API_URL: "http://localhost:4100", NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" };

for (const app of ["sg-app", "sg-backoffice"]) {
  console.log(`\n▶ building ${app} for e2e…`);
  execFileSync("pnpm", ["exec", "next", "build"], { cwd: path.join(root, app), env, stdio: "inherit" });
}
console.log("\n✓ e2e builds ready");
