import { SignJWT } from "jose";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./context";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { hashPassword, verifyPassword } from "./lib/password";
import { rateLimit } from "./lib/rate-limit";
import { logActivity } from "./lib/activity";
import { inc } from "./lib/metrics";

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
   *  Rate-limited per email (10 / 15min) to blunt credential stuffing. */
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
      /** Optional client hint for audit (never trusted for auth). */
      client: z.string().max(80).optional(),
    }))
    .mutation(async ({ input }) => {
      const emailKey = input.email.toLowerCase();
      const rl = rateLimit(`login:${emailKey}`, 10, 15 * 60_000);
      if (!rl.allowed) {
        inc("login_rate_limited");
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many login attempts. Retry in ${rl.retryAfterSec}s.`,
        });
      }

      // 1. Try DB user lookup
      try {
        const db = getDb();
        const rows = await db.select().from(users).where(eq(users.email, emailKey)).limit(1);
        const row = rows[0];
        if (row && row.passwordHash) {
          const ok = await verifyPassword(input.password, row.passwordHash);
          if (!ok) {
            inc("login_fail");
            await logActivity({
              actor: emailKey,
              action: "auth.login_fail",
              resource: "users",
              detail: "bad_password",
              meta: { client: input.client ?? null },
            });
            return { success: false as const, error: "Invalid credentials" };
          }
          const token = await signToken(row.email, row.role ?? "user");
          inc("login_success");
          await logActivity({
            actor: row.email,
            action: "auth.login",
            resource: "users",
            detail: "db_user",
            meta: { role: row.role ?? "user", client: input.client ?? null },
          });
          return { success: true as const, token, user: { email: row.email, role: row.role ?? "user" } };
        }
      } catch {
        // DB not reachable / table missing → fall through to env-admin fallback
      }

      // 2. Env-admin bootstrap fallback
      const envMatch =
        emailKey === env.adminEmail.toLowerCase() &&
        input.password === env.adminPassword;
      if (envMatch) {
        const token = await signToken(env.adminEmail, "admin");
        inc("login_success");
        await logActivity({
          actor: env.adminEmail,
          action: "auth.login",
          resource: "users",
          detail: "env_admin",
          meta: { client: input.client ?? null },
        });
        return { success: true as const, token, user: { email: env.adminEmail, role: "admin" } };
      }

      inc("login_fail");
      await logActivity({
        actor: emailKey,
        action: "auth.login_fail",
        resource: "users",
        detail: "unknown_user",
      });
      return { success: false as const, error: "Invalid credentials" };
    }),

  /** Create a new user. Protected — admin session required in practice (any authed user for bootstrap). */
  register: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
      role: z.enum(["user", "admin"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin role required to register users" });
      }
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
      await logActivity({
        actor: ctx.user.email,
        action: "auth.register",
        resource: "users",
        detail: input.email.toLowerCase(),
        meta: { role: input.role ?? "user" },
      });
      return { success: true as const, user: { email: input.email.toLowerCase(), role: input.role ?? "user" } };
    }),

  /** Change password for the current DB-backed user (env-admin has no DB row). */
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = getDb();
        const rows = await db.select().from(users).where(eq(users.email, ctx.user.email.toLowerCase())).limit(1);
        const row = rows[0];
        if (!row?.passwordHash) {
          return {
            success: false as const,
            error: "No DB user for this session (env-admin). Register a real admin user first.",
          };
        }
        const ok = await verifyPassword(input.currentPassword, row.passwordHash);
        if (!ok) return { success: false as const, error: "Current password incorrect" };
        const passwordHash = await hashPassword(input.newPassword);
        await db.update(users).set({ passwordHash }).where(eq(users.id, row.id));
        await logActivity({
          actor: ctx.user.email,
          action: "auth.change_password",
          resource: "users",
        });
        return { success: true as const };
      } catch (e: any) {
        return { success: false as const, error: e?.message ?? "Change password failed" };
      }
    }),

  /** Admin: list registered DB users (no password hashes). */
  listUsers: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
    }
    try {
      const db = getDb();
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          createdAt: users.createdAt,
          hasPassword: users.passwordHash,
        })
        .from(users)
        .orderBy(desc(users.createdAt));
      return {
        users: rows.map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          role: r.role,
          createdAt: r.createdAt,
          hasPassword: !!r.hasPassword,
        })),
      };
    } catch (e: any) {
      return { users: [], error: (e?.message ?? String(e)).slice(0, 200) };
    }
  }),

  /** Re-issue a fresh token from a valid (possibly near-expiry) session. */
  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    const token = await signToken(ctx.user.email, ctx.user.role);
    return { success: true as const, token, user: ctx.user };
  }),

  /** Echoes the current user from the verified JWT. */
  me: publicProcedure.query(async ({ ctx }) => {
    return ctx.user ? { authenticated: true as const, user: ctx.user } : { authenticated: false as const };
  }),

  /** Bootstrap: ensure env admin exists as a DB row so password can be rotated later. */
  bootstrapAdmin: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
    }
    try {
      const db = getDb();
      const email = env.adminEmail.toLowerCase();
      const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existing[0]) {
        return { success: true as const, created: false, email };
      }
      const passwordHash = await hashPassword(env.adminPassword);
      await db.insert(users).values({
        email,
        name: "Admin",
        passwordHash,
        role: "admin",
      });
      await logActivity({
        actor: ctx.user.email,
        action: "auth.bootstrap_admin",
        resource: "users",
        detail: email,
      });
      return { success: true as const, created: true, email };
    } catch (e: any) {
      return { success: false as const, error: e?.message ?? "bootstrap failed" };
    }
  }),
});
