import { TRPCError } from "@trpc/server";
import { env } from "./env";

/** Demo data is a development convenience and must never disguise a failed live operation. */
export function requireDevelopmentFallback(): void {
  if (env.production) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The data service is unavailable" });
}
