import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { jwtVerify } from "jose";
import { env } from "./lib/env";

const t = initTRPC.context<AuthContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export type AuthUser = { email: string; role: string };
export type AuthContext = { user?: AuthUser | null };

const secretBytes = () => new TextEncoder().encode(env.authSecret);

/** Middleware that verifies the JWT from ctx.user (populated in boot.ts createContext)
 *  and attaches the decoded user. Throws UNAUTHORIZED if missing/invalid. */
const authMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(authMiddleware);

/** Verifies a raw Authorization bearer token. Returns the user claim or null. */
export async function verifyBearer(header: string | null | undefined): Promise<AuthUser | null> {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], secretBytes(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { email: payload.sub, role: (payload.role as string) ?? "user" };
  } catch {
    return null;
  }
}