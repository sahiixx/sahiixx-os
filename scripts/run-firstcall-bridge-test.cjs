// Bundles + runs the FirstCall bridge checks. Lives inside the repo so that
// `require('esbuild')` resolves against ./node_modules (the repo uses esbuild
// via vite; tsx is NOT a dependency here).
// Run: node scripts/run-firstcall-bridge-test.cjs
const path = require("path");
const esbuild = require("esbuild");
const { execFileSync } = require("child_process");

const out = path.join(__dirname, "..", "node_modules", ".cache", "fcbridge_test.mjs");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "test-firstcall-bridge.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "error",
});
console.log("bundled ->", out);
execFileSync(process.execPath, [out], { stdio: "inherit" });
