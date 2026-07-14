// In-memory seeded stores — the "demo mode" fallback when Neon is unreachable.
// The Neon DATABASE_URL in .dev.vars is invalid (password auth failed), so every
// sahiixx-router procedure wraps its DB read in try/catch and falls back to these
// stores. Writes append here on DB failure too, so the UI is fully interactive
// (create deals / agents / signals / contacts / campaigns / videos) even with no
// DB. The moment a valid Neon URL is restored, queries auto-switch back to the
// real DB because the try/catch succeeds first.
//
// Rows are typed via drizzle's `$inferSelect` so demo rows match the real DB row
// types EXACTLY — no TS union divergence between demo and live paths.
//
// Module-level mutable arrays: a write in one request is visible to the next
// read. This mirrors Jarvis's in-memory session pattern. Process restart wipes
// it (acceptable for demo mode).

import {
  agents, mcpServers, deals, contacts, campaigns, videos, signalAlerts, deployedAgents,
  documents, documentTypes, matchingRules,
} from "@db/schema";

export type AgentRow = typeof agents.$inferSelect;
export type McpRow = typeof mcpServers.$inferSelect;
export type DealRow = typeof deals.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type VideoRow = typeof videos.$inferSelect;
export type SignalRow = typeof signalAlerts.$inferSelect;
export type DeployedRow = typeof deployedAgents.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentTypeRow = typeof documentTypes.$inferSelect;
export type MatchingRuleRow = typeof matchingRules.$inferSelect;

const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const ahead = (ms: number) => new Date(now + ms);

// ── agents (6 — mirrors the Kimi Command Center demo) ──────────────────────────
export const demoAgents: AgentRow[] = [
  { id: 1, name: "Code Agent Alpha", type: "code", status: "busy", model: "gpt-4o", task: "Refactoring auth module", progress: 67, output: "api.ts:88 Missing return type\ntypes.ts:42 Unexpected any", createdAt: ago(3600_000 * 2), updatedAt: ago(60_000) },
  { id: 2, name: "Review Agent Beta", type: "review", status: "busy", model: "claude-3.5-sonnet", task: "Reviewing PR #234", progress: 45, output: "22 comments · 4 blockers", createdAt: ago(3600_000 * 5), updatedAt: ago(120_000) },
  { id: 3, name: "Test Agent Gamma", type: "test", status: "busy", model: "gpt-4o-mini", task: "Running test suite", progress: 92, output: "247 passed, 0 failed", createdAt: ago(3600_000 * 3), updatedAt: ago(30_000) },
  { id: 4, name: "Deploy Agent Delta", type: "deploy", status: "idle", model: "codellama", task: "Awaiting trigger", progress: 0, output: "Rolling update: 3/3 pods ready", createdAt: ago(3600_000 * 8), updatedAt: ago(900_000) },
  { id: 5, name: "Lint Agent Epsilon", type: "lint", status: "busy", model: "gpt-4o", task: "Scanning ESLint errors", progress: 78, output: "Auto-fixed 31 errors · 16 manual", createdAt: ago(3600_000 * 1), updatedAt: ago(45_000) },
  { id: 6, name: "Doc Agent Zeta", type: "docs", status: "online", model: "claude-3-haiku", task: "API docs generated", progress: 100, output: "docs/api.md · 2.1k words", createdAt: ago(3600_000 * 12), updatedAt: ago(600_000) },
];

// ── mcp servers (5) ───────────────────────────────────────────────────────────
export const demoMcp: McpRow[] = [
  { id: 1, name: "filesystem-mcp", type: "filesystem", authType: "none", status: "connected", latency: 12, url: "file://C:\\Users\\sahii", version: "0.4.1", requestsCount: 18421, createdAt: ago(3600_000 * 40) },
  { id: 2, name: "github-mcp", type: "github", authType: "oauth", status: "connected", latency: 88, url: "https://api.github.com", version: "2.3.0", requestsCount: 9032, createdAt: ago(3600_000 * 100) },
  { id: 3, name: "neon-mcp", type: "database", authType: "api-key", status: "warning", latency: 410, url: "https://neon.tech", version: "1.0.0", requestsCount: 2210, createdAt: ago(3600_000 * 30) },
  { id: 4, name: "puppeteer-mcp", type: "browser", authType: "none", status: "connected", latency: 140, url: "local", version: "0.3.2", requestsCount: 540, createdAt: ago(3600_000 * 15) },
  { id: 5, name: "slack-mcp", type: "messaging", authType: "oauth", status: "disconnected", latency: 0, url: "https://slack.com", version: "1.2.0", requestsCount: 0, createdAt: ago(3600_000 * 60) },
];

// ── deals (8 — Dubai real estate) ──────────────────────────────────────────────
export const demoDeals: DealRow[] = [
  { id: 1, dealId: "DXB-2041", property: "Palm Jumeirah Villa", type: "Villa", area: "Palm Jumeirah", priceAed: 28_500_000, score: 94, tier: "HARD", commission: 2.5, status: "active", createdAt: ago(3600_000 * 6) },
  { id: 2, dealId: "DXB-2038", property: "Marina Gate Tower 2", type: "Apartment", area: "Dubai Marina", priceAed: 3_200_000, score: 81, tier: "MEDIUM", commission: 2.0, status: "active", createdAt: ago(3600_000 * 26) },
  { id: 3, dealId: "DXB-2035", property: "Downtown Burj View", type: "Apartment", area: "Downtown Dubai", priceAed: 4_900_000, score: 76, tier: "MEDIUM", commission: 2.0, status: "pending", createdAt: ago(3600_000 * 50) },
  { id: 4, dealId: "DXB-2030", property: "Jumeirah Beach Residence", type: "Apartment", area: "JBR", priceAed: 6_750_000, score: 88, tier: "HARD", commission: 2.5, status: "active", createdAt: ago(3600_000 * 72) },
  { id: 5, dealId: "DXB-2028", property: "Business Bay Penthouse", type: "Penthouse", area: "Business Bay", priceAed: 12_400_000, score: 72, tier: "LOW", commission: 1.5, status: "active", createdAt: ago(3600_000 * 90) },
  { id: 6, dealId: "DXB-2019", property: "Arabian Ranches III", type: "Townhouse", area: "Arabian Ranches", priceAed: 5_300_000, score: 64, tier: "LOW", commission: 1.5, status: "closed", createdAt: ago(3600_000 * 200) },
  { id: 7, dealId: "DXB-2015", property: "Bluewaters Island Residences", type: "Apartment", area: "Bluewaters", priceAed: 8_900_000, score: 90, tier: "HARD", commission: 2.5, status: "active", createdAt: ago(3600_000 * 120) },
  { id: 8, dealId: "DXB-2007", property: "Dubai Hills Estate Villa", type: "Villa", area: "Dubai Hills", priceAed: 18_700_000, score: 85, tier: "MEDIUM", commission: 2.0, status: "lost", createdAt: ago(3600_000 * 300) },
];

// ── contacts (10 — RFM-tiered CRM) ────────────────────────────────────────────
export const demoContacts: ContactRow[] = [
  { id: 1, name: "Ahmed Al Mansoori", phone: "+971501234567", email: "ahmed@almansoori.ae", units: 12, totalValue: 142_000_000, rfmScore: 95, tier: "Champions", area: "Palm Jumeirah", lastContact: ago(86_400_000), createdAt: ago(3600_000 * 400) },
  { id: 2, name: "Sara bint Khalid", phone: "+971502345678", email: "sara@khalidholdings.com", units: 8, totalValue: 96_000_000, rfmScore: 91, tier: "Champions", area: "Emirates Hills", lastContact: ago(2 * 86_400_000), createdAt: ago(3600_000 * 380) },
  { id: 3, name: "Mohammed Razvi", phone: "+971503456789", email: "m.razvi@razvigroup.ae", units: 5, totalValue: 41_000_000, rfmScore: 82, tier: "Top", area: "Downtown Dubai", lastContact: ago(5 * 86_400_000), createdAt: ago(3600_000 * 300) },
  { id: 4, name: "Fatima Al Zarooni", phone: "+971504567890", email: "fatima@zarooni.io", units: 6, totalValue: 53_000_000, rfmScore: 79, tier: "Top", area: "JBR", lastContact: ago(7 * 86_400_000), createdAt: ago(3600_000 * 260) },
  { id: 5, name: "James Whitfield", phone: "+971556789012", email: "j.whitfield@whitfield.co.uk", units: 3, totalValue: 18_400_000, rfmScore: 68, tier: "Loyal", area: "Business Bay", lastContact: ago(14 * 86_400_000), createdAt: ago(3600_000 * 200) },
  { id: 6, name: "Priya Nair", phone: "+971557890123", email: "priya@nairinvestments.in", units: 4, totalValue: 22_100_000, rfmScore: 61, tier: "Loyal", area: "Dubai Marina", lastContact: ago(21 * 86_400_000), createdAt: ago(3600_000 * 170) },
  { id: 7, name: "Omar Al Futtaim", phone: "+971558901234", email: "omar@futtaimcap.ae", units: 2, totalValue: 9_800_000, rfmScore: 54, tier: "Loyal", area: "Bluewaters", lastContact: ago(30 * 86_400_000), createdAt: ago(3600_000 * 140) },
  { id: 8, name: "Lina Hadid", phone: "+971559012345", email: "lina@hadidproperties.com", units: 1, totalValue: 3_200_000, rfmScore: 38, tier: "At Risk", area: "JVC", lastContact: ago(65 * 86_400_000), createdAt: ago(3600_000 * 110) },
  { id: 9, name: "Vikram Shah", phone: "+971550123456", email: "vikram@shahventures.in", units: 1, totalValue: 2_750_000, rfmScore: 29, tier: "At Risk", area: "Arabian Ranches", lastContact: ago(80 * 86_400_000), createdAt: ago(3600_000 * 95) },
  { id: 10, name: "Elena Petrova", phone: "+971551234567", email: "elena@petrovarealty.ru", units: 0, totalValue: 0, rfmScore: 14, tier: "At Risk", area: "Business Bay", lastContact: ago(120 * 86_400_000), createdAt: ago(3600_000 * 80) },
];

// ── campaigns (4) ─────────────────────────────────────────────────────────────
export const demoCampaigns: CampaignRow[] = [
  { id: 1, name: "Palm Owners Q3 Reactivation", template: "Off-market villa alert", language: "English", sent: 142, delivered: 138, opened: 91, status: "sent", createdAt: ago(3600_000 * 20) },
  { id: 2, name: "Marina Investors Blast", template: "New launch preview", language: "English", sent: 0, delivered: 0, opened: 0, status: "scheduled", createdAt: ago(3600_000 * 4) },
  { id: 3, name: "Arabic RERA Compliance Series", template: "RERA rules digest", language: "Arabic", sent: 88, delivered: 84, opened: 52, status: "sent", createdAt: ago(3600_000 * 70) },
  { id: 4, name: "Bluewaters Penthouse Teaser", template: "Single-property brochure", language: "English", sent: 0, delivered: 0, opened: 0, status: "draft", createdAt: ago(3600_000 * 2) },
];

// ── videos (5) ────────────────────────────────────────────────────────────────
export const demoVideos: VideoRow[] = [
  { id: 1, title: "Palm Jumeirah Signature Villa Walkthrough", status: "published", platform: "YouTube", progress: 100, duration: 184, createdAt: ago(3600_000 * 24) },
  { id: 2, title: "Marina Gate Investment Teaser", status: "generating", platform: "Instagram", progress: 64, duration: 38, createdAt: ago(3600_000 * 2) },
  { id: 3, title: "Downtown Burj View Reel", status: "editing", platform: "TikTok", progress: 41, duration: 28, createdAt: ago(3600_000 * 6) },
  { id: 4, title: "Bluewaters Penthouse Launch", status: "pending", platform: "YouTube", progress: 0, duration: null, createdAt: ago(3600_000 * 1) },
  { id: 5, title: "JBR Beachfront Drone Cut", status: "failed", platform: "Instagram", progress: 22, duration: null, createdAt: ago(3600_000 * 12) },
];

// ── signals (6) ───────────────────────────────────────────────────────────────
export const demoSignals: SignalRow[] = [
  { id: 1, category: "market", severity: "critical", message: "Palm Jumeirah villa prices +18% YoY — inventory below 30 active listings", source: "DLD feed", timestamp: ago(120_000) },
  { id: 2, category: "deal", severity: "high", message: "DXB-2041 buyer went silent 72h — escalate to call", source: "NEXUS", timestamp: ago(600_000) },
  { id: 3, category: "compliance", severity: "high", message: "RERA Form B required before DXB-2035 deposit release", source: "RERA watch", timestamp: ago(1_800_000) },
  { id: 4, category: "market", severity: "medium", message: "Dubai Marina 2BR median down 3% MoM — buyer's window opening", source: "Bayut", timestamp: ago(3_600_000) },
  { id: 5, category: "agent", severity: "medium", message: "Lint Agent Epsilon auto-fixed 31 errors — 16 require manual review", source: "Gapclaw", timestamp: ago(5_400_000) },
  { id: 6, category: "system", severity: "low", message: "neon-mcp latency drifted to 410ms (threshold 300ms)", source: "MCP monitor", timestamp: ago(7_200_000) },
];

// ── deployed agents (4) ───────────────────────────────────────────────────────
export const demoDeployed: DeployedRow[] = [
  { id: 1, name: "Palm Lead Scanner", template: "lead-scanner", status: "active", target: "DLD + Bayut", lastRun: ago(900_000), createdAt: ago(3600_000 * 30) },
  { id: 2, name: "WhatsApp Follow-up Bot", template: "followup-bot", status: "active", target: "sahiix-estate", lastRun: ago(300_000), createdAt: ago(3600_000 * 22) },
  { id: 3, name: "RERA Compliance Watch", template: "compliance-watch", status: "idle", target: "RERA portal", lastRun: ago(3600_000 * 6), createdAt: ago(3600_000 * 50) },
  { id: 4, name: "Market Sentiment Crawler", template: "sentiment-crawler", status: "deploying", target: "News + Twitter", lastRun: null, createdAt: ago(600_000) },
];

// ── documents (5 — Dubai real-estate contracts/offers, the module's domain) ───
// `fts` is a generated tsvector column in the live table; in demo mode we never
// run FTS (search falls back to substring), so it's just a placeholder string.
export const demoDocuments: DocumentRow[] = [
  {
    id: 1, sourceName: "Palm-Jumeirah-Offer-Letter.pdf", sourcePath: "F:\\ALL_MY_FILES\\contracts\\palm_offer.pdf",
    docType: "offer", title: "Offer to Purchase — Palm Jumeirah Villa", docDate: ago(3600_000 * 48),
    summary: "Buyer offer for a 5BR Palm Jumeirah villa at AED 28.5M, 10% deposit, 60-day completion.",
    ocrText: "OFFER TO PURCHASE. Property: Palm Jumeirah, Villa 24, Frond M. Buyer: Ahmed Al Mansoori. Seller: Nakheel. Purchase price: AED 28,500,000. Deposit: 10% (AED 2,850,000) payable to escrow agent within 7 days. Completion: 60 days from signing. This offer is valid for 14 days. Subject to RERA Form B and DLD NOC.",
    metadata: { parties: ["Ahmed Al Mansoori", "Nakheel"], amounts: ["AED 28,500,000", "AED 2,850,000"], dates: [], propertyRefs: ["Palm Jumeirah Villa 24 Frond M"], jurisdiction: "Dubai" },
    tags: ["palm", "high-value"], createdAt: ago(3600_000 * 48), fts: "",
  },
  {
    id: 2, sourceName: "Marina-Gate-SPA.pdf", sourcePath: null,
    docType: "contract", title: "Sale and Purchase Agreement — Marina Gate Tower 2",
    docDate: ago(3600_000 * 96),
    summary: "Signed SPA for a 2BR Marina Gate unit at AED 3.2M; service charges and handover terms attached.",
    ocrText: "SALE AND PURCHASE AGREEMENT. Unit: Marina Gate Tower 2, Apartment 1402. Developer: Emaar. Purchaser: Priya Nair. Price: AED 3,200,000. Service charges: AED 18 per sqft annually. Handover: Q3 2026. Dispute resolution: Dubai Courts. Property ref: DXB-2038.",
    metadata: { parties: ["Priya Nair", "Emaar"], amounts: ["AED 3,200,000"], dates: [], propertyRefs: ["Marina Gate Tower 2 Apt 1402"], jurisdiction: "Dubai" },
    tags: ["marina", "apartment"], createdAt: ago(3600_000 * 96), fts: "",
  },
  {
    id: 3, sourceName: "Downtown-Listing-Sheet.pdf", sourcePath: null,
    docType: "listing", title: "Listing Sheet — Downtown Burj View 2BR",
    docDate: ago(3600_000 * 12),
    summary: "Active listing, AED 4.9M, 2BR Downtown Burj view, high floor, vacant.",
    ocrText: "LISTING SHEET. Property: Downtown Burj View, 2BR, floor 38. Asking: AED 4,900,000. Status: Vacant. View: Burj Khalifa. Agent: SAHIIX. RERA permit: 87219. Listing ref: DXB-2035.",
    metadata: { parties: ["SAHIIX"], amounts: ["AED 4,900,000"], dates: [], propertyRefs: ["Downtown Burj View 2BR fl38"], jurisdiction: "Dubai" },
    tags: ["downtown"], createdAt: ago(3600_000 * 12), fts: "",
  },
  {
    id: 4, sourceName: "RERA-Form-B.pdf", sourcePath: null,
    docType: "letter", title: "RERA Form B — Buyer Acknowledgement",
    docDate: ago(3600_000 * 6),
    summary: "RERA Form B buyer acknowledgement for DXB-2035; required before deposit release.",
    ocrText: "RERA Form B. Buyer acknowledgement. Project: Downtown Burj View. Buyer: Mohammed Razvi. Real estate regulatory agency, Dubai Land Department. Form B required prior to release of deposit funds. Registration number 77192.",
    metadata: { parties: ["Mohammed Razvi"], amounts: [], dates: [], propertyRefs: ["DXB-2035"], jurisdiction: "Dubai" },
    tags: ["rera", "compliance"], createdAt: ago(3600_000 * 6), fts: "",
  },
  {
    id: 5, sourceName: "JBR-Title-Deed.jpg", sourcePath: null,
    docType: "id", title: "Title Deed — Jumeirah Beach Residence",
    docDate: ago(3600_000 * 240),
    summary: "Title deed scan for a JBR apartment, owner Fatima Al Zarooni.",
    ocrText: "TITLE DEED. Property: Jumeirah Beach Residence, Tower 5, Apartment 2201. Owner: Fatima Al Zarooni. Plot: 3551-901. Area: 1420 sqft. DLD title deed number 2024-118842.",
    metadata: { parties: ["Fatima Al Zarooni"], amounts: [], dates: [], propertyRefs: ["JBR Tower 5 Apt 2201"], jurisdiction: "Dubai" },
    tags: ["jbr", "deed"], createdAt: ago(3600_000 * 240), fts: "",
  },
];

export const demoDocTypes: DocumentTypeRow[] = [
  { id: 1, name: "Offer", description: "Offer to purchase / letter of intent", accent: "#FF9500" },
  { id: 2, name: "Contract", description: "Signed sale & purchase agreement", accent: "#FF1A1A" },
  { id: 3, name: "Listing", description: "Agent listing sheet", accent: "#0088FF" },
  { id: 4, name: "Compliance", description: "RERA / DLD forms", accent: "#FFAA00" },
  { id: 5, name: "Deed", description: "Title deed / ownership document", accent: "#00DD77" },
];

export const demoRules: MatchingRuleRow[] = [
  { id: 1, algorithm: "keyword", expression: "all offer to purchase", target: "type", targetValue: "offer", createdAt: ago(3600_000 * 200) },
  { id: 2, algorithm: "keyword", expression: "all sale and purchase agreement", target: "type", targetValue: "contract", createdAt: ago(3600_000 * 200) },
  { id: 3, algorithm: "keyword", expression: "any listing sheet", target: "type", targetValue: "listing", createdAt: ago(3600_000 * 200) },
  { id: 4, algorithm: "keyword", expression: "any title deed", target: "type", targetValue: "id", createdAt: ago(3600_000 * 200) },
  { id: 5, algorithm: "regex", expression: "rera\\s+form\\s+[a-z]", target: "tag", targetValue: "compliance", createdAt: ago(3600_000 * 180) },
  { id: 6, algorithm: "keyword", expression: "any palm jumeirah", target: "tag", targetValue: "palm", createdAt: ago(3600_000 * 180) },
  { id: 7, algorithm: "fuzzy", expression: "deposit~2", target: "tag", targetValue: "deposit", createdAt: ago(3600_000 * 180) },
];

// next id helper for demo-mode appends
let nextAgentId = demoAgents.length + 1;
let nextDealId = demoDeals.length + 1;
let nextContactId = demoContacts.length + 1;
let nextCampaignId = demoCampaigns.length + 1;
let nextVideoId = demoVideos.length + 1;
let nextSignalId = demoSignals.length + 1;
let nextDeployedId = demoDeployed.length + 1;
let nextMcpId = demoMcp.length + 1;
let nextDocumentId = demoDocuments.length + 1;
let nextDocTypeId = demoDocTypes.length + 1;
let nextRuleId = demoRules.length + 1;

export function addDemoAgent(row: Omit<AgentRow, "id" | "createdAt" | "updatedAt">): AgentRow {
  const r: AgentRow = { ...row, id: nextAgentId++, createdAt: new Date(), updatedAt: new Date() };
  demoAgents.unshift(r);
  return r;
}
export function addDemoDeal(row: Omit<DealRow, "id" | "createdAt">): DealRow {
  const r: DealRow = { ...row, id: nextDealId++, createdAt: new Date() };
  demoDeals.unshift(r);
  return r;
}
export function addDemoContact(row: Omit<ContactRow, "id" | "createdAt">): ContactRow {
  const r: ContactRow = { ...row, id: nextContactId++, createdAt: new Date() };
  demoContacts.unshift(r);
  return r;
}
export function addDemoCampaign(row: Omit<CampaignRow, "id" | "createdAt">): CampaignRow {
  const r: CampaignRow = { ...row, id: nextCampaignId++, createdAt: new Date() };
  demoCampaigns.unshift(r);
  return r;
}
export function addDemoVideo(row: Omit<VideoRow, "id" | "createdAt">): VideoRow {
  const r: VideoRow = { ...row, id: nextVideoId++, createdAt: new Date() };
  demoVideos.unshift(r);
  return r;
}
export function addDemoSignal(row: Omit<SignalRow, "id" | "timestamp">): SignalRow {
  const r: SignalRow = { ...row, id: nextSignalId++, timestamp: new Date() };
  demoSignals.unshift(r);
  return r;
}
export function addDemoDeployed(row: Omit<DeployedRow, "id" | "createdAt" | "lastRun">): DeployedRow {
  const r: DeployedRow = { ...row, id: nextDeployedId++, lastRun: null, createdAt: new Date() };
  demoDeployed.unshift(r);
  return r;
}
export function addDemoDocument(row: Omit<DocumentRow, "id" | "createdAt" | "fts">): DocumentRow {
  const r: DocumentRow = { ...row, id: nextDocumentId++, createdAt: new Date(), fts: "" };
  demoDocuments.unshift(r);
  return r;
}
export function addDemoRule(row: Omit<MatchingRuleRow, "id" | "createdAt">): MatchingRuleRow {
  const r: MatchingRuleRow = { ...row, id: nextRuleId++, createdAt: new Date() };
  demoRules.unshift(r);
  return r;
}

// Live system metrics for the Command Center (the Kimi demo's CPU/mem/disk/uptime
// panel). Mutated by a ticking clock so the values feel alive without a real DB.
export function liveMetrics() {
  // deterministic-ish drift from the process start so it changes between polls
  const t = Date.now();
  const cpu = 38 + Math.round(8 * Math.sin(t / 9000));
  const mem = 4.0 + Math.round((Math.sin(t / 13000) + 1) * 4) / 10;
  const netTx = 10 + Math.round(4 * Math.sin(t / 7000));
  const netRx = 7 + Math.round(3 * Math.cos(t / 7000));
  return {
    cpuPct: cpu,
    cpuCores: 6,
    memGb: mem.toFixed(1),
    memTotalGb: 8,
    diskPct: 78,
    netTx: netTx.toFixed(1),
    netRx: netRx.toFixed(1),
    uptimeDays: 45,
    uptimeH: 12,
    uptimeM: 33,
    wsConnections: 5,
    region: "ae-dubai-1",
  };
}

export const pipelineStages = [
  { stage: "Lint", status: "done", detail: "Auto-fixed 31 errors · 16 manual" },
  { stage: "Test", status: "done", detail: "247 passed, 0 failed · 87.3%" },
  { stage: "Build", status: "done", detail: "sahix/os:v3.0.2 (234MB)" },
  { stage: "Push", status: "done", detail: "Pushing to registry → complete" },
  { stage: "Deploy", status: "active", detail: "Rolling update 3/3 pods ready" },
];

export const modelRegistry = [
  { model: "claude-3.5-sonnet", state: "ACTIVE", assigned: "Review Agent" },
  { model: "gpt-4o", state: "ACTIVE", assigned: "Code Agent, Lint Agent" },
  { model: "gpt-4o-mini", state: "ACTIVE", assigned: "Test Agent" },
  { model: "claude-3-haiku", state: "ACTIVE", assigned: "Doc Agent" },
  { model: "codellama", state: "STANDBY", assigned: "Deploy Agent" },
];

// used by Hub to show per-module live counts
export function moduleCounts() {
  return {
    agents: demoAgents.length,
    activeAgents: demoAgents.filter((a) => a.status === "busy" || a.status === "online").length,
    deals: demoDeals.length,
    contacts: demoContacts.length,
    campaigns: demoCampaigns.length,
    videos: demoVideos.length,
    signals: demoSignals.length,
    criticalSignals: demoSignals.filter((s) => s.severity === "critical").length,
    deployed: demoDeployed.length,
    mcp: demoMcp.filter((m) => m.status === "connected").length,
    mcpTotal: demoMcp.length,
  };
}