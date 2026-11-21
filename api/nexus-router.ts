/**
 * NEXUS live bridge — proxies the WSL sahiix-estate API into tRPC.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./context";
import { estateConfigured, estateHealth, estateLeads } from "./lib/estate";
import { env } from "./lib/env";
import { logActivity } from "./lib/activity";

export const nexusRouter = router({
  estateConfig: protectedProcedure.query(() => ({
    configured: estateConfigured(),
    baseUrl: env.estateApiUrl
      ? env.estateApiUrl.replace(/\/\/([^/@]+@)?/, "//") // strip userinfo if any
      : null,
    note: estateConfigured()
      ? "Live estate API bridge enabled"
      : "Set ESTATE_API_URL (tunnel/public) for prod; local dev defaults to http://127.0.0.1:3001",
  })),

  estateHealth: publicProcedure.query(async () => estateHealth()),

  estateLeads: protectedProcedure.query(async () => estateLeads()),

  /** Import a live estate lead into the Neon deals table as a LOW/MEDIUM shell. */
  importLeadAsDeal: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        tier: z.enum(["HARD", "MEDIUM", "LOW", "CLOSED"]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const health = await estateHealth();
      if (!health.ok) return { success: false as const, error: health.error ?? "estate health unavailable" };
      const source = health.body;
      if (typeof source === "object" && source !== null && "recovery" in source && source.recovery === true) {
        return { success: false as const, error: "Recovery snapshots cannot be imported as live deals" };
      }
      const { ok, leads, error } = await estateLeads();
      if (!ok) return { success: false as const, error: error ?? "estate unreachable" };
      const lead = leads.find((l) => l.id === input.leadId);
      if (!lead) return { success: false as const, error: "lead not found" };

      // Lazy import to avoid circular deps with sahiixx-router
      const { getDb } = await import("./queries/connection");
      const { deals } = await import("@db/schema");
      try {
        const db = getDb();
        const dealId = `ESTATE-${lead.id}`;
        const inserted = await db.insert(deals).values({
          dealId,
          property: lead.property_title || lead.name || `Lead ${lead.id}`,
          type: "estate-lead",
          area: null,
          priceAed: 0,
          score: 50,
          tier: input.tier ?? "MEDIUM",
          status: "active",
          commission: null,
        } as any)
          .onConflictDoNothing({ target: deals.dealId })
          .returning();
        // Let the unique constraint arbitrate concurrent retries. Never reset
        // an existing deal's tier/status or emit a second import activity.
        if (inserted.length === 0) {
          return { success: true as const, dealId, alreadyImported: true };
        }
        await logActivity({
          actor: ctx.user.email,
          action: "nexus.import_lead",
          resource: "deals",
          detail: dealId,
          meta: { leadId: lead.id, name: lead.name },
        });
        return { success: true as const, dealId, alreadyImported: false };
      } catch (e: any) {
        // Demo fallback: still report shape
        return { success: false as const, error: env.production ? "Estate import failed" : (e?.message ?? String(e)).slice(0, 200) };
      }
    }),
});
