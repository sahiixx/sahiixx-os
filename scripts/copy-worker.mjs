/**
 * Pages Advanced Mode: Hono API must live at dist/public/_worker.js
 * so wrangler pages deploy serves API + static assets on the same origin.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const boot = join(root, "dist", "boot.js");
const outDir = join(root, "dist", "public");
const worker = join(outDir, "_worker.js");

if (!existsSync(boot)) {
  console.error("copy-worker: missing dist/boot.js — run esbuild first");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(boot, worker);

// Prefer Worker for API; assets for everything else when possible.
// Advanced mode with a single _worker.js handles all routes via Hono.
writeFileSync(
  join(outDir, "_routes.json"),
  JSON.stringify(
    {
      version: 1,
      include: ["/*"],
      exclude: [],
    },
    null,
    2,
  ),
);

console.log("copy-worker: wrote dist/public/_worker.js + _routes.json");
