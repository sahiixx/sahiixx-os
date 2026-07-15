/**
 * NEXUS live bridge — proxies the WSL sahiix-estate API into tRPC.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./context";
import { estateConfigured, estateHealth, estateLeads } from "./lib/estate";
import { env } from "./lib/env";
import { logActivity } from "./lib/activity";

export const nexusRouter = router({
  estateConfig: publicProcedure.query(() => ({
    configured: estateConfigured(),
    baseUrl: env.estateApiUrl
      ? env.estateApiUrl.replace(/\/\/([^/@]+@)?/, "//") // strip userinfo if any
      : null,
    note: estateConfigured()
      ? "Live estate API bridge enabled"
      : "Set ESTATE_API_URL (tunnel/public) for prod; local dev defaults to http://127.0.0.1:3001",
  })),

  estateHealth: publicProcedure.query(async () => estateHealth()),

  estateLeads: publicProcedure.query(async () => estateLeads()),

  /** Import a live estate lead into the Neon deals table as a LOW/MEDIUM shell. */
  importLeadAsDeal: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        tier: z.enum(["HARD", "MEDIUM", "LOW", "CLOSED"]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
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
        await db.insert(deals).values({
          dealId,
          property: lead.property_title || lead.name || `Lead ${lead.id}`,
          type: "estate-lead",
          area: null,
          priceAed: 0,
          score: 50,
          tier: input.tier ?? "MEDIUM",
          status: "active",
          commission: null,
        } as any);
        await logActivity({
          actor: ctx.user.email,
          action: "nexus.import_lead",
          resource: "deals",
          detail: dealId,
          meta: { leadId: lead.id, name: lead.name },
        });
        return { success: true as const, dealId };
      } catch (e: any) {
        // Demo fallback: still report shape
        return { success: false as const, error: (e?.message ?? String(e)).slice(0, 200) };
      }
    }),
});
