import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./context";
import { getDb } from "./queries/connection";
import { agents, mcpServers, deals, contacts, campaigns, videos, signalAlerts, deployedAgents } from "@db/schema";
import { eq, desc, like, sql, inArray } from "drizzle-orm";
import {
  demoAgents, demoMcp, demoDeals, demoContacts, demoCampaigns, demoVideos, demoSignals, demoDeployed,
  addDemoAgent, addDemoDeal, addDemoContact, addDemoCampaign, addDemoVideo, addDemoSignal, addDemoDeployed,
  liveMetrics, pipelineStages, modelRegistry, moduleCounts as demoModuleCounts,
  type AgentRow, type McpRow, type DealRow, type ContactRow, type CampaignRow, type VideoRow, type SignalRow, type DeployedRow,
} from "./queries/demo-data";
import { probePostiz, listIntegrations, createPost, type PostizIntegration, type PostizPostInput } from "./postiz";
import { ingestLead, probeSovereign, sovereignConfigured, type SovereignLeadInput } from "./sovereign";
import { logActivity } from "./lib/activity";

// Demo-fallback pattern: every read tries the real DB first, and on ANY error
// (Neon unreachable, invalid creds, missing DATABASE_URL) returns the seeded
// demo store sorted as the query intended. Writes append to the demo store on
// DB failure so the UI stays interactive with no DB. dbStatus exposes which
// mode we're in so the Layout banner can show "DEMO MODE".

export const sahiixxRouter = router({
  // ── DB health probe ───────────────────────────────────────────────────────
  dbStatus: publicProcedure.query(async () => {
    try {
      const db = getDb();
      await db.select().from(agents).limit(1);
      return { demo: false, error: null as string | null };
    } catch (e: any) {
      const cause = e?.cause?.message ?? e?.cause ?? "";
      const msg = [e?.message ?? String(e), cause].filter(Boolean).join(" | ");
      return { demo: true, error: msg.slice(0, 300) };
    }
  }),

  // ── agents ────────────────────────────────────────────────────────────────
  agentList: publicProcedure.query(async (): Promise<AgentRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(agents).orderBy(desc(agents.updatedAt));
    } catch {
      return [...demoAgents].sort((a, b) => (b.updatedAt ?? new Date(0)).getTime() - (a.updatedAt ?? new Date(0)).getTime());
    }
  }),

  agentCreate: protectedProcedure.input(z.object({
    name: z.string(), type: z.string(), model: z.string().optional(),
    task: z.string().optional(), status: z.enum(["online", "busy", "error", "idle"]).optional()
  })).mutation(async ({ input, ctx }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.insert(agents).values(input as any);
      await logActivity({
        actor: ctx.user.email,
        action: "agent.create",
        resource: "agents",
        detail: input.name,
        meta: { type: input.type, model: input.model ?? null },
      });
      return { success: true, demo: false };
    } catch {
      addDemoAgent({
        name: input.name, type: input.type, model: input.model ?? "sonnet-4.6",
        status: input.status ?? "idle", task: input.task ?? null, progress: 0, output: null,
      });
      return { success: true, demo: true };
    }
  }),

  agentUpdate: protectedProcedure.input(z.object({
    id: z.number(), status: z.enum(["online", "busy", "error", "idle"]).optional(), progress: z.number().optional(),
    task: z.string().optional(), output: z.string().optional()
  })).mutation(async ({ input }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(agents).set(data as any).where(eq(agents.id, id));
      return { success: true, demo: false };
    } catch {
      const a = demoAgents.find((x) => x.id === input.id);
      if (a) {
        if (input.status) a.status = input.status;
        if (input.progress != null) a.progress = input.progress;
        if (input.task != null) a.task = input.task;
        if (input.output != null) a.output = input.output;
        a.updatedAt = new Date();
      }
      return { success: true, demo: true };
    }
  }),

  agentDelete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.delete(agents).where(eq(agents.id, input.id));
      return { success: true, demo: false };
    } catch {
      const i = demoAgents.findIndex((x) => x.id === input.id);
      if (i >= 0) demoAgents.splice(i, 1);
      return { success: true, demo: true };
    }
  }),

  // ── mcp ───────────────────────────────────────────────────────────────────
  mcpList: publicProcedure.query(async (): Promise<McpRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(mcpServers);
    } catch {
      return [...demoMcp];
    }
  }),

  // ── deals ──────────────────────────────────────────────────────────────────
  dealList: publicProcedure.query(async (): Promise<DealRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(deals).orderBy(desc(deals.score));
    } catch {
      return [...demoDeals].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
  }),

  dealCreate: protectedProcedure.input(z.object({
    dealId: z.string(), property: z.string(), type: z.string().optional(),
    area: z.string().optional(), priceAed: z.number(), score: z.number().optional(),
    tier: z.enum(["HARD", "MEDIUM", "LOW", "CLOSED"]).optional(), commission: z.number().optional()
  })).mutation(async ({ input, ctx }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.insert(deals).values(input as any);
      await logActivity({
        actor: ctx.user.email,
        action: "deal.create",
        resource: "deals",
        detail: input.dealId,
        meta: { property: input.property, tier: input.tier ?? "LOW", priceAed: input.priceAed },
      });
      return { success: true, demo: false };
    } catch {
      addDemoDeal({
        dealId: input.dealId, property: input.property, type: input.type ?? null,
        area: input.area ?? null, priceAed: input.priceAed, score: input.score ?? 0,
        tier: input.tier ?? "LOW", commission: input.commission ?? null, status: "active",
      });
      return { success: true, demo: true };
    }
  }),

  dealUpdate: protectedProcedure.input(z.object({
    id: z.number(),
    tier: z.enum(["HARD", "MEDIUM", "LOW", "CLOSED"]).optional(),
    status: z.enum(["active", "pending", "closed", "lost"]).optional(),
    score: z.number().optional(),
    commission: z.number().optional(),
    property: z.string().optional(),
  })).mutation(async ({ input, ctx }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(deals).set(data as any).where(eq(deals.id, id));
      await logActivity({
        actor: ctx.user.email,
        action: "deal.update",
        resource: "deals",
        detail: String(id),
        meta: data as Record<string, unknown>,
      });
      return { success: true, demo: false };
    } catch {
      const d = demoDeals.find((x) => x.id === input.id);
      if (d) {
        if (input.tier) d.tier = input.tier;
        if (input.status) d.status = input.status;
        if (input.score != null) d.score = input.score;
        if (input.commission != null) d.commission = input.commission;
        if (input.property) d.property = input.property;
      }
      return { success: true, demo: true };
    }
  }),

  // ── contacts ───────────────────────────────────────────────────────────────
  contactList: publicProcedure.query(async (): Promise<ContactRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(contacts).orderBy(desc(contacts.rfmScore));
    } catch {
      return [...demoContacts].sort((a, b) => (b.rfmScore ?? 0) - (a.rfmScore ?? 0));
    }
  }),

  contactSearch: publicProcedure.input(z.object({ query: z.string() })).query(async ({ input }): Promise<ContactRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(contacts).where(like(contacts.name, `%${input.query}%`));
    } catch {
      const q = input.query.toLowerCase();
      return demoContacts.filter((c) => c.name.toLowerCase().includes(q) || (c.area ?? "").toLowerCase().includes(q));
    }
  }),

  contactCreate: protectedProcedure.input(z.object({
    name: z.string(), phone: z.string().optional(), email: z.string().optional(),
    units: z.number().optional(), totalValue: z.number().optional(), rfmScore: z.number().optional(),
    tier: z.enum(["Champions", "Top", "Loyal", "At Risk"]).optional(), area: z.string().optional(),
  })).mutation(async ({ input, ctx }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.insert(contacts).values(input as any);
      await logActivity({
        actor: ctx.user.email,
        action: "contact.create",
        resource: "contacts",
        detail: input.name,
      });
      return { success: true, demo: false };
    } catch {
      addDemoContact({
        name: input.name, phone: input.phone ?? null, email: input.email ?? null,
        units: input.units ?? 0, totalValue: input.totalValue ?? 0, rfmScore: input.rfmScore ?? 0,
        tier: input.tier ?? "Loyal", area: input.area ?? null, lastContact: null,
      });
      return { success: true, demo: true };
    }
  }),

  // ── campaigns ──────────────────────────────────────────────────────────────
  campaignList: publicProcedure.query(async (): Promise<CampaignRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
    } catch {
      return [...demoCampaigns].sort((a, b) => (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime());
    }
  }),

  campaignCreate: protectedProcedure.input(z.object({
    name: z.string(), template: z.string().optional(), language: z.string().optional(),
  })).mutation(async ({ input }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.insert(campaigns).values(input as any);
      return { success: true, demo: false };
    } catch {
      addDemoCampaign({
        name: input.name, template: input.template ?? null,
        language: input.language ?? "English", sent: 0, delivered: 0, opened: 0, status: "draft",
      });
      return { success: true, demo: true };
    }
  }),

  // ── videos ─────────────────────────────────────────────────────────────────
  videoList: publicProcedure.query(async (): Promise<VideoRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(videos).orderBy(desc(videos.createdAt));
    } catch {
      return [...demoVideos].sort((a, b) => (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime());
    }
  }),

  videoCreate: protectedProcedure.input(z.object({
    title: z.string(), platform: z.string().optional(), status: z.enum(["generating", "editing", "pending", "published", "failed"]).optional(), duration: z.number().optional(),
  })).mutation(async ({ input }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.insert(videos).values(input as any);
      return { success: true, demo: false };
    } catch {
      addDemoVideo({
        title: input.title, status: input.status ?? "pending",
        platform: input.platform ?? null, progress: 0, duration: input.duration ?? null,
      });
      return { success: true, demo: true };
    }
  }),

  // ── signals ─────────────────────────────────────────────────────────────────
  signalList: publicProcedure.query(async (): Promise<SignalRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(signalAlerts).orderBy(desc(signalAlerts.timestamp));
    } catch {
      return [...demoSignals].sort((a, b) => (b.timestamp ?? new Date(0)).getTime() - (a.timestamp ?? new Date(0)).getTime());
    }
  }),

  signalCreate: protectedProcedure.input(z.object({
    category: z.string(), severity: z.enum(["critical", "high", "medium", "low"]), message: z.string(), source: z.string().optional()
  })).mutation(async ({ input, ctx }): Promise<{ success: true; demo: boolean; sovereign?: any }> => {
    let sovereignResult: any = undefined;
    try {
      const db = getDb();
      await db.insert(signalAlerts).values(input as any);
      await logActivity({
        actor: ctx.user.email,
        action: "signal.create",
        resource: "signal_alerts",
        detail: input.message.slice(0, 120),
        meta: { severity: input.severity, category: input.category },
      });
      try {
        sovereignResult = await ingestLead({
          message: input.message,
          source: input.source ?? "sahiixx-os",
          buyer_type: input.category,
        });
      } catch (e: any) {
        console.warn("[sovereign] ingest failed:", e?.message ?? e);
      }
      return { success: true, demo: false, sovereign: sovereignResult ?? null };
    } catch {
      addDemoSignal({
        category: input.category, severity: input.severity, message: input.message, source: input.source ?? null,
      });
      try {
        sovereignResult = await ingestLead({
          message: input.message,
          source: input.source ?? "sahiixx-os",
          buyer_type: input.category,
        });
      } catch (e: any) {
        console.warn("[sovereign] ingest failed (demo path):", e?.message ?? e);
      }
      return { success: true, demo: true, sovereign: sovereignResult ?? null };
    }
  }),

  // ── deployed agents ─────────────────────────────────────────────────────────
  deployedList: publicProcedure.query(async (): Promise<DeployedRow[]> => {
    try {
      const db = getDb();
      return await db.select().from(deployedAgents).orderBy(desc(deployedAgents.createdAt));
    } catch {
      return [...demoDeployed].sort((a, b) => (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime());
    }
  }),

  deployedCreate: protectedProcedure.input(z.object({
    name: z.string(), template: z.string(), target: z.string()
  })).mutation(async ({ input }): Promise<{ success: true; demo: boolean }> => {
    try {
      const db = getDb();
      await db.insert(deployedAgents).values(input);
      return { success: true, demo: false };
    } catch {
      addDemoDeployed({ name: input.name, template: input.template, status: "deploying", target: input.target });
      return { success: true, demo: true };
    }
  }),

  // ── Command Center live ops data ───────────────────────────────────────────
  opsMetrics: publicProcedure.query(async () => {
    // Base synthetic host metrics + real agent busy count when DB is live
    const base = liveMetrics();
    try {
      const db = getDb();
      const busy = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(agents)
        .where(inArray(agents.status, ["busy", "online"]));
      return {
        ...base,
        activeAgents: Number(busy[0]?.n ?? 0),
        source: "live+db" as const,
      };
    } catch {
      return { ...base, source: "synthetic" as const };
    }
  }),
  opsPipeline: publicProcedure.query(async () => {
    return pipelineStages;
  }),
  opsModels: publicProcedure.query(async () => {
    return modelRegistry;
  }),
  /** Hub launcher counts — prefer Neon, fall back to in-memory demo seed. */
  moduleCounts: publicProcedure.query(async () => {
    try {
      const db = getDb();
      const [a, d, c, camp, v, s, dep, m] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(agents),
        db.select({ n: sql<number>`count(*)::int` }).from(deals),
        db.select({ n: sql<number>`count(*)::int` }).from(contacts),
        db.select({ n: sql<number>`count(*)::int` }).from(campaigns),
        db.select({ n: sql<number>`count(*)::int` }).from(videos),
        db.select({ n: sql<number>`count(*)::int` }).from(signalAlerts),
        db.select({ n: sql<number>`count(*)::int` }).from(deployedAgents),
        db.select({ n: sql<number>`count(*)::int` }).from(mcpServers),
      ]);
      const activeAgents = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(agents)
        .where(inArray(agents.status, ["busy", "online"]));
      const criticalSignals = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(signalAlerts)
        .where(eq(signalAlerts.severity, "critical"));
      const mcpOnline = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(mcpServers)
        .where(eq(mcpServers.status, "connected"));
      return {
        agents: Number(a[0]?.n ?? 0),
        activeAgents: Number(activeAgents[0]?.n ?? 0),
        deals: Number(d[0]?.n ?? 0),
        contacts: Number(c[0]?.n ?? 0),
        campaigns: Number(camp[0]?.n ?? 0),
        videos: Number(v[0]?.n ?? 0),
        signals: Number(s[0]?.n ?? 0),
        criticalSignals: Number(criticalSignals[0]?.n ?? 0),
        deployed: Number(dep[0]?.n ?? 0),
        mcp: Number(mcpOnline[0]?.n ?? 0),
        mcpTotal: Number(m[0]?.n ?? 0),
        source: "db" as const,
      };
    } catch {
      return { ...demoModuleCounts(), source: "demo" as const };
    }
  }),

  // ── Postiz (SARA content factory — real social scheduling) ──────────────────
  // All three gracefully return {available:false} when Postiz isn't configured
  // (no POSTIZ_API_URL/KEY), so the SARA page shows local-tracking mode instead.
  postizStatus: publicProcedure.query(async () => {
    return probePostiz();
  }),

  postizIntegrations: publicProcedure.query(async (): Promise<{ available: boolean; integrations: PostizIntegration[]; error: string | null }> => {
    try {
      const list = await listIntegrations();
      if (list == null) return { available: false, integrations: [], error: null };
      return { available: true, integrations: list, error: null };
    } catch (e: any) {
      return { available: false, integrations: [], error: (e?.message ?? String(e)).slice(0, 200) };
    }
  }),

  postizSchedule: protectedProcedure.input(z.object({
    integrationId: z.string(),
    platformType: z.string(),
    content: z.string(),
    type: z.enum(["now", "schedule"]),
    date: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).mutation(async ({ input }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    try {
      const post: PostizPostInput = {
        integrationId: input.integrationId,
        platformType: input.platformType,
        content: input.content,
        type: input.type,
        date: input.date,
        tags: input.tags,
      };
      const res = await createPost(post);
      return { ok: true, id: res.id };
    } catch (e: any) {
      return { ok: false, error: (e?.message ?? String(e)).slice(0, 200) };
    }
  }),

  // ── Sovereign Revenue OS (lead pipeline bridge) ────────────────────────────
  // Pushes a scored lead into the live sovereign pipeline and returns the
  // scored envelope. Public (no auth) so the bridge can be exercised from
  // automation without a session; the sovereign API itself enforces X-API-Key.
  ingestLead: publicProcedure.input(z.object({
    message: z.string(),
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    source: z.string().optional(),
    budget_min: z.number().int().optional(),
    budget_max: z.number().int().optional(),
    buyer_type: z.string().optional(),
  })).mutation(async ({ input }): Promise<{ configured: boolean; result?: any; error?: string }> => {
    if (!sovereignConfigured()) return { configured: false };
    try {
      const result = await ingestLead(input as SovereignLeadInput);
      return { configured: true, result };
    } catch (e: any) {
      return { configured: true, error: (e?.message ?? String(e)).slice(0, 200) };
    }
  }),

  sovereignStatus: publicProcedure.query(async () => {
    return probeSovereign();
  }),
});