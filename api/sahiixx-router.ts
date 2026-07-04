import { z } from "zod";
import { router, publicProcedure } from "./context";
import { getDb } from "./queries/connection";
import { agents, mcpServers, deals, contacts, campaigns, videos, signalAlerts, deployedAgents } from "@db/schema";
import { eq, desc, like } from "drizzle-orm";

export const sahiixxRouter = router({
  agentList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(agents).orderBy(desc(agents.updatedAt));
  }),

  agentCreate: publicProcedure.input(z.object({
    name: z.string(), type: z.string(), model: z.string().optional(),
    task: z.string().optional(), status: z.string().optional()
  })).mutation(async ({ input }) => {
    const db = getDb();
    await db.insert(agents).values(input);
    return { success: true };
  }),

  agentUpdate: publicProcedure.input(z.object({
    id: z.number(), status: z.string().optional(), progress: z.number().optional(),
    task: z.string().optional(), output: z.string().optional()
  })).mutation(async ({ input }) => {
    const db = getDb();
    const { id, ...data } = input;
    await db.update(agents).set(data).where(eq(agents.id, id));
    return { success: true };
  }),

  agentDelete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.delete(agents).where(eq(agents.id, input.id));
    return { success: true };
  }),

  mcpList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(mcpServers);
  }),

  dealList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(deals).orderBy(desc(deals.score));
  }),

  dealCreate: publicProcedure.input(z.object({
    dealId: z.string(), property: z.string(), type: z.string().optional(),
    area: z.string().optional(), priceAed: z.number(), score: z.number().optional(),
    tier: z.string().optional(), commission: z.number().optional()
  })).mutation(async ({ input }) => {
    const db = getDb();
    await db.insert(deals).values(input);
    return { success: true };
  }),

  contactList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(contacts).orderBy(desc(contacts.rfmScore));
  }),

  contactSearch: publicProcedure.input(z.object({ query: z.string() })).query(async ({ input }) => {
    const db = getDb();
    return db.select().from(contacts).where(like(contacts.name, `%${input.query}%`));
  }),

  campaignList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  }),

  videoList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(videos).orderBy(desc(videos.createdAt));
  }),

  signalList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(signalAlerts).orderBy(desc(signalAlerts.timestamp));
  }),

  signalCreate: publicProcedure.input(z.object({
    category: z.string(), severity: z.string(), message: z.string(), source: z.string().optional()
  })).mutation(async ({ input }) => {
    const db = getDb();
    await db.insert(signalAlerts).values(input);
    return { success: true };
  }),

  deployedList: publicProcedure.query(async () => {
    const db = getDb();
    return db.select().from(deployedAgents).orderBy(desc(deployedAgents.createdAt));
  }),

  deployedCreate: publicProcedure.input(z.object({
    name: z.string(), template: z.string(), target: z.string()
  })).mutation(async ({ input }) => {
    const db = getDb();
    await db.insert(deployedAgents).values(input);
    return { success: true };
  }),
});
