import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  envDir: false,
  resolve: { alias: { "@db/schema": fileURLToPath(new URL("./db/schema.ts", import.meta.url)) } },
  test: { include: ["scripts/tests/production-security.test.ts"], environment: "node" },
});
