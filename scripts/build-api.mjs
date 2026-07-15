/**
 * Build API for Node (dist/boot.js) and Cloudflare Pages Worker (dist/public/_worker.js).
 */
import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "api", "boot.ts");

const common = {
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  logLevel: "info",
  // Keep pg as external? No — CF nodejs_compat needs it bundled or as node built-in polyfill.
  // Bundle everything; Workers provide node: modules via nodejs_compat.
};

// Node production start (npm start)
await esbuild.build({
  ...common,
  outfile: join(root, "dist", "boot.js"),
  banner: {
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
  },
});

// Cloudflare Pages Advanced Mode worker — no createRequire (import.meta.url is undefined there)
mkdirSync(join(root, "dist", "public"), { recursive: true });
await esbuild.build({
  ...common,
  outfile: join(root, "dist", "public", "_worker.js"),
  banner: {
    // Minimal shim so any accidental require() in deps does not crash at module load.
    js: `const require = (n) => { throw new Error('require() not available in Workers: ' + n); };`,
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

writeFileSync(
  join(root, "dist", "public", "_routes.json"),
  JSON.stringify({ version: 1, include: ["/*"], exclude: [] }, null, 2),
);

console.log("build-api: dist/boot.js + dist/public/_worker.js + _routes.json");
