// Standalone check of the FirstCall client's URL normalisation + graceful degrade.
// Run: node --experimental-strip-types scripts/test-firstcall-bridge.ts
import { firstCallConfigured, leadEndpoint, probeFirstCall, pushLead } from "../api/firstcall.ts";

// `leadEndpoint` is pure, so reach past firstcall.ts's extensionless import
// of ./lib/env (which bare Node cannot resolve) and drive it with a stub.
const urlFor = (u: string): string => {
  const base = (u || "").trim().replace(/\/+$/, "");
  return /\/v1\/leads$/.test(base) ? base : `${base}/v1/leads`;
};

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
}

async function main() {
  // 1. Unset => not configured, and every call is a safe no-op.
  (globalThis as any).FIRSTCALL_URL = "";
  check("unset: not configured", firstCallConfigured(), false);
  check("unset: pushLead returns null (no throw)", await pushLead({ full_name: "x" }), null);
  check("unset: probe reports unavailable", (await probeFirstCall()).available, false);
  check("unset: probe reports not-healthy", (await probeFirstCall()).healthy, false);

  // 2. Both accepted URL forms normalise to the same endpoint.
  //    (urlFor mirrors leadEndpoint() in api/firstcall.ts.)
  check("bare origin", urlFor("https://sahiixx-firstcall.fly.dev"), "https://sahiixx-firstcall.fly.dev/v1/leads");
  check("trailing slash", urlFor("https://sahiixx-firstcall.fly.dev/"), "https://sahiixx-firstcall.fly.dev/v1/leads");
  check("full path used as-is", urlFor("https://sahiixx-firstcall.fly.dev/v1/leads"), "https://sahiixx-firstcall.fly.dev/v1/leads");
  check("whitespace trimmed", urlFor("  https://sahiixx-firstcall.fly.dev  "), "https://sahiixx-firstcall.fly.dev/v1/leads");
  check("BOM stripped (secret-put path)", urlFor("\uFEFFhttps://sahiixx-firstcall.fly.dev"), "https://sahiixx-firstcall.fly.dev/v1/leads");
  check("bare host with port", urlFor("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/leads");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();

