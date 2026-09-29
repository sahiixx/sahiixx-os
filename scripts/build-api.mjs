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
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  conditions: ["worker", "browser", "import", "module", "default"],
  mainFields: ["module", "main"],
  // nodejs_compat on Workers provides node: builtins; keep them external.
  external: [
    "cloudflare:workers",
    "node:fs",
    "node:path",
    "node:url",
    "node:crypto",
    "node:stream",
    "node:buffer",
    "node:util",
    "node:events",
    "node:os",
    "node:net",
    "node:tls",
    "node:http",
    "node:https",
    "node:zlib",
    "node:child_process",
  ],
};

try {
  console.log("build-api: bundling Node dist/boot.js ...");
  await esbuild.build({
    ...common,
    platform: "node",
    outfile: join(root, "dist", "boot.js"),
    banner: {
      js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
    },
  });

  console.log("build-api: bundling Pages _worker.js ...");
  mkdirSync(join(root, "dist", "public"), { recursive: true });
  await esbuild.build({
    ...common,
    outfile: join(root, "dist", "public", "_worker.js"),
    banner: {
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

  console.log("build-api: OK → dist/boot.js + dist/public/_worker.js + _routes.json");
} catch (err) {
  console.error("build-api FAILED:", err?.message ?? err);
  if (err?.errors) {
    for (const e of err.errors) console.error("  ", e.text);
  }
  process.exit(1);
}
