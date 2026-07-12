// db/seed.ts -- populates the 8 domain tables with realistic SAHIIX OS sample data.
// Run with:  npm run db:seed   (after `npm run db:push` and a valid DATABASE_URL in .env)
//
// Idempotent: truncates every seeded table first, then re-inserts. Does NOT touch
// `users` -- that table holds PBKDF2 password hashes managed by auth.register /
// the env-admin bootstrap; seeding a plaintext password here would be wrong.
//
// Env: reads DATABASE_URL via dotenv (.env) through the same `env` helper the
// backend uses, so the seed uses the identical DB client as production code.

import "dotenv/config";
import { getDb } from "../api/queries/connection";
import {
  agents,
  mcpServers,
  deals,
  contacts,
  campaigns,
  videos,
  signalAlerts,
  deployedAgents,
} from "@db/schema";

const db = getDb();

const agentRows: (typeof agents.$inferInsert)[] = [
  { name: "Atlas Scout", type: "research", status: "online", model: "sonnet-4.6", task: "Sourcing off-market Palm listings", progress: 72, output: "3 new prospects matched tier criteria" },
  { name: "Nexus Closer", type: "sales", status: "busy", model: "opus-4.8", task: "Following up with Champion-tier contacts", progress: 41, output: "Drafting personalized outreach to 4 owners" },
  { name: "Sara Voice", type: "voice", status: "idle", model: "haiku-4.5", task: "Inbound call triage", progress: 0, output: null },
  { name: "Gapclaw Auditor", type: "audit", status: "error", model: "sonnet-4.6", task: "RERA compliance scan on listing copy", progress: 88, output: "2 listings flagged for unverified claims" },
];

const mcpRows: (typeof mcpServers.$inferInsert)[] = [
  { name: "NEXUS Estate DB", type: "database", authType: "oauth", status: "connected", latency: 42, url: "https://nexus.local/mcp", version: "3.2.0", requestsCount: 18420 },
  { name: "DLD Property Feed", type: "api", authType: "apikey", status: "connected", latency: 118, url: "https://dld.ae/mcp", version: "1.4.1", requestsCount: 6230 },
  { name: "WhatsApp Cloud", type: "messaging", authType: "oauth", status: "warning", latency: 240, url: "https://wa.me/mcp", version: "2.0.0", requestsCount: 9120 },
  { name: "Ollama Local", type: "llm", authType: "none", status: "disconnected", latency: 0, url: "http://localhost:11434", version: "0.3.0", requestsCount: 0 },
];

const dealRows: (typeof deals.$inferInsert)[] = [
  { dealId: "PALM-VLA-001", property: "Villa Palm Jumeirah Frond M", type: "villa", area: "Palm Jumeirah", priceAed: 28500000, score: 92, tier: "HARD", commission: 2.5, status: "active" },
  { dealId: "DIFX-APT-014", property: "Apartment DIFC Boulevard 02", type: "apartment", area: "DIFC", priceAed: 4200000, score: 68, tier: "MEDIUM", commission: 2.0, status: "pending" },
  { dealId: "BUSN-OFX-220", property: "Office Business Bay Tower", type: "commercial", area: "Business Bay", priceAed: 6800000, score: 54, tier: "LOW", commission: 1.5, status: "active" },
  { dealId: "PALM-VLA-007", property: "Villa Palm Frond K (off-market)", type: "villa", area: "Palm Jumeirah", priceAed: 41000000, score: 88, tier: "HARD", commission: 2.5, status: "closed" },
];

const contactRows: (typeof contacts.$inferInsert)[] = [
  { name: "Ahmed Al Mansoori", phone: "+971501234567", email: "ahmed@example.ae", units: 6, totalValue: 124000000, rfmScore: 540, tier: "Champions", area: "Palm Jumeirah", lastContact: new Date("2026-06-28") },
  { name: "Sara Khoury", phone: "+971502345678", email: "sara@example.ae", units: 3, totalValue: 58000000, rfmScore: 410, tier: "Top", area: "DIFC", lastContact: new Date("2026-06-15") },
  { name: "Li Wei", phone: "+971503456789", email: "liwei@example.ae", units: 2, totalValue: 31000000, rfmScore: 280, tier: "Loyal", area: "Business Bay", lastContact: new Date("2026-05-20") },
  { name: "Omar Farouk", phone: "+971504567890", email: "omar@example.ae", units: 1, totalValue: 9500000, rfmScore: 120, tier: "At Risk", area: "Dubai Marina", lastContact: new Date("2026-02-10") },
];

const campaignRows: (typeof campaigns.$inferInsert)[] = [
  { name: "Palm Off-Market Q3", template: "offmarket-intro", language: "English", sent: 120, delivered: 116, opened: 78, status: "sending" },
  { name: "DIFC Investors AR", template: "monthly-update", language: "Arabic", sent: 240, delivered: 238, opened: 154, status: "sent" },
  { name: "RERA Compliance Push", template: "compliance-notice", language: "English", sent: 0, delivered: 0, opened: 0, status: "draft" },
];

const videoRows: (typeof videos.$inferInsert)[] = [
  { title: "Palm Frond M Walkthrough", status: "published", platform: "youtube", progress: 100, duration: 184 },
  { title: "DIFC Investor Briefing", status: "editing", platform: "linkedin", progress: 62, duration: null },
  { title: "Business Bay Tower Promo", status: "generating", platform: "youtube", progress: 35, duration: null },
];

const signalRows: (typeof signalAlerts.$inferInsert)[] = [
  { category: "deal", severity: "critical", message: "Palm VLA-007 owner responded to off-market offer", source: "NEXUS Estate DB", timestamp: new Date() },
  { category: "compliance", severity: "high", message: "2 listings contain unverified RERA claims", source: "Gapclaw Auditor", timestamp: new Date(Date.now() - 60_000) },
  { category: "contact", severity: "medium", message: "Champion-tier contact Ahmed inactive 9 days", source: "NEXUS Estate DB", timestamp: new Date(Date.now() - 120_000) },
  { category: "system", severity: "low", message: "Ollama local LLM disconnected", source: "MCP Monitor", timestamp: new Date(Date.now() - 300_000) },
];

const deployedRows: (typeof deployedAgents.$inferInsert)[] = [
  { name: "Inbound Triage Bot", template: "sara-voice", status: "active", target: "WhatsApp +971501111222", lastRun: new Date(Date.now() - 5 * 60_000) },
  { name: "Listings Compliance Sweep", template: "gapclaw-audit", status: "idle", target: "DLD Feed", lastRun: new Date(Date.now() - 2 * 3600_000) },
  { name: "Owner Outreach Drafter", template: "nexus-closer", status: "deploying", target: "Champions segment", lastRun: null },
];

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed] DATABASE_URL is not set. Put a valid Neon connection string in .env first.");
    process.exit(1);
  }

  console.log("[seed] clearing tables...");
  // No FKs in the schema, so delete order is free. users is intentionally skipped.
  for (const t of [deployedAgents, signalAlerts, videos, campaigns, contacts, deals, mcpServers, agents]) {
    await db.delete(t);
  }

  console.log("[seed] inserting sample rows...");
  await db.insert(agents).values(agentRows);
  await db.insert(mcpServers).values(mcpRows);
  await db.insert(deals).values(dealRows);
  await db.insert(contacts).values(contactRows);
  await db.insert(campaigns).values(campaignRows);
  await db.insert(videos).values(videoRows);
  await db.insert(signalAlerts).values(signalRows);
  await db.insert(deployedAgents).values(deployedRows);

  console.log(
    `[seed] done: ${agentRows.length} agents, ${mcpRows.length} mcp, ${dealRows.length} deals, ` +
      `${contactRows.length} contacts, ${campaignRows.length} campaigns, ${videoRows.length} videos, ` +
      `${signalRows.length} signals, ${deployedRows.length} deployed agents.`
  );
  process.exit(0);
}

seed().catch((e) => {
  console.error("[seed] failed:", e);
  process.exit(1);
});