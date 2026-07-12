import { SignJWT } from "jose";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "./context";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { hashPassword, verifyPassword } from "./lib/password";

const secretBytes = () => new TextEncoder().encode(env.authSecret);

async function signToken(email: string, role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretBytes());
}

export const authRouter = router({
  /** Login: DB-backed user first, env-admin bootstrap fallback.
   *  - If a users row exists for the email with a passwordHash, verify it.
   *  - Otherwise fall back to the env-configured admin creds (so the first
   *    admin can log in and create other users before any DB rows exist).
   *  - DB unavailable (no creds set / connection error) also falls back to env admin. */
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string() }))
    .mutation(async ({ input }) => {
      // 1. Try DB user lookup
      try {
        const db = getDb();
        const rows = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
        const row = rows[0];
        if (row && row.passwordHash) {
          const ok = await verifyPassword(input.password, row.passwordHash);
          if (!ok) return { success: false as const, error: "Invalid credentials" };
          const token = await signToken(row.email, row.role ?? "user");
          return { success: true as const, token, user: { email: row.email, role: row.role ?? "user" } };
        }
      } catch {
        // DB not reachable / table missing → fall through to env-admin fallback
      }

      // 2. Env-admin bootstrap fallback
      const envMatch =
        input.email.toLowerCase() === env.adminEmail.toLowerCase() &&
        input.password === env.adminPassword;
      if (envMatch) {
        const token = await signToken(env.adminEmail, "admin");
        return { success: true as const, token, user: { email: env.adminEmail, role: "admin" } };
      }

      return { success: false as const, error: "Invalid credentials" };
    }),

  /** Create a new user. Protected — only an authenticated (admin) session can
   *  register users, so the bootstrap env-admin creates the first real users. */
  register: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
      role: z.enum(["user", "admin"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const passwordHash = await hashPassword(input.password);
      try {
        await db.insert(users).values({
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash,
          role: input.role ?? "user",
        });
      } catch (e: any) {
        return { success: false as const, error: e?.message ?? "Insert failed (email may already exist)" };
      }
      return { success: true as const, user: { email: input.email.toLowerCase(), role: input.role ?? "user" } };
    }),

  /** Re-issue a fresh token from a valid (possibly near-expiry) session. */
  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    const token = await signToken(ctx.user.email, ctx.user.role);
    return { success: true as const, token, user: ctx.user };
  }),

  /** Echoes the current user from the verified JWT. */
  me: publicProcedure.query(async ({ ctx }) => {
    return ctx.user ? { authenticated: true, user: ctx.user } : { authenticated: false };
  }),
});