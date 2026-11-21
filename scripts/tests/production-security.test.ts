import { describe, it, expect, vi } from "vitest";
import { SignJWT } from "jose";
import { withRequestBindings, runtimeBinding } from "../../api/lib/runtime";
import { env } from "../../api/lib/env";
import { verifyBearer } from "../../api/context";
import { requireDevelopmentFallback } from "../../api/lib/production-policy";
import { hashPassword, verifyPassword } from "../../api/lib/password";
const production = { APP_ENV: "production", AUTH_SECRET: "synthetic-security-test-only-secret-12345" };

describe("production boundaries", () => {
  it("rejects missing and known development authentication secrets", () => {
    for (const AUTH_SECRET of [undefined, "short", "sahiixx-dev-secret-change-me"]) {
      expect(() => withRequestBindings({ APP_ENV: "production", AUTH_SECRET }, () => env.authSecret)).toThrow();
    }
  });
  it("does not offer default production administrator credentials", () => {
    withRequestBindings(production, () => { expect(env.adminEmail).toBe(""); expect(env.adminPassword).toBe(""); });
  });
  it("keeps concurrent request bindings isolated and does not inherit missing secrets", async () => {
    await Promise.all(["first", "second"].map(value => withRequestBindings({ KEY: value }, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(runtimeBinding("KEY")).toBe(value);
      expect(runtimeBinding("AUTH_SECRET")).toBeUndefined();
    })));
  });
  it("rejects demo fallbacks in production", () => {
    expect(() => withRequestBindings(production, requireDevelopmentFallback)).toThrow("data service is unavailable");
    expect(() => withRequestBindings({ APP_ENV: "development" }, requireDevelopmentFallback)).not.toThrow();
  });
  it("validates issuer, audience, expiration and role", async () => {
    await withRequestBindings(production, async () => {
      const sign = (role: string, issuer = "sahiixx-os") => new SignJWT({ role }).setProtectedHeader({ alg: "HS256" })
        .setSubject("fixture@example.invalid").setIssuer(issuer).setAudience("sahiixx-os-client")
        .setIssuedAt().setExpirationTime("1m").sign(new TextEncoder().encode(env.authSecret));
      expect(await verifyBearer(`Bearer ${await sign("admin")}`)).toEqual({ email: "fixture@example.invalid", role: "admin" });
      expect(await verifyBearer(`Bearer ${await sign("owner")}`)).toBeNull();
      expect(await verifyBearer(`Bearer ${await sign("user", "other-app")}`)).toBeNull();
      expect(await verifyBearer("Bearer malformed")).toBeNull();
    });
  });
  it("hashes passwords and rejects malformed or excessive work factors", async () => {
    const stored = await hashPassword("synthetic-password");
    expect(stored.startsWith("pbkdf2$600000$")).toBe(true);
    expect(await verifyPassword("synthetic-password", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    for (const hash of ["pbkdf2$Infinity$?$?", "pbkdf2$999999999$a$b", "pbkdf2$100000$?$?"]) expect(await verifyPassword("x", hash)).toBe(false);
  });
});

vi.mock("../../api/queries/connection", () => ({
  getDb: () => { throw new Error("synthetic database failure with sensitive details"); },
  activeDatabaseMode: () => "none",
  testConnection: async () => ({ ok: false }),
}));
import app from "../../api/boot";
describe("HTTP production integration", () => {
  const bindings = { ...production, ADMIN_EMAIL: "fixture@example.invalid", ADMIN_PASSWORD: "synthetic-password" };
  it("keeps business reads private", async () => {
    for (const procedure of ["sahiixx.contactList", "documents.list", "nexus.estateLeads", "system.activityList"]) {
      const result = await app.request(`/api/trpc/${procedure}`, {}, bindings);
      expect(result.status, procedure).toBe(401);
    }
  });
  it("disables diagnostic routes and protects metrics", async () => {
    expect((await app.request("/api/env-check", {}, bindings)).status).toBe(404);
    expect((await app.request("/api/db-test", {}, bindings)).status).toBe(404);
    expect((await app.request("/api/metrics", {}, bindings)).status).toBe(401);
  });
  it("redacts public readiness errors", async () => {
    const result = await app.request("/api/ready", {}, bindings);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("sensitive details");
  });
  it("never authenticates an environment administrator during a production DB outage", async () => {
    const result = await app.request("/api/trpc/auth.login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { email: bindings.ADMIN_EMAIL, password: bindings.ADMIN_PASSWORD } }),
    }, bindings);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('"token"');
  });
});
