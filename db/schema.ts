import { pgTable, serial, varchar, integer, bigint, text, timestamp, real, pgEnum } from "drizzle-orm/pg-core";

export const agentStatusEnum = pgEnum("agent_status", ["online", "busy", "error", "idle"]);
export const mcpStatusEnum = pgEnum("mcp_status", ["connected", "warning", "error", "disconnected"]);
export const dealTierEnum = pgEnum("deal_tier", ["HARD", "MEDIUM", "LOW", "CLOSED"]);
export const dealStatusEnum = pgEnum("deal_status", ["active", "pending", "closed", "lost"]);
export const contactTierEnum = pgEnum("contact_tier", ["Champions", "Top", "Loyal", "At Risk"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "sending", "sent", "scheduled"]);
export const videoStatusEnum = pgEnum("video_status", ["generating", "editing", "pending", "published", "failed"]);
export const signalSeverityEnum = pgEnum("signal_severity", ["critical", "high", "medium", "low"]);
export const deployedStatusEnum = pgEnum("deployed_status", ["active", "idle", "error", "deploying"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  email: varchar("email", { length: 100 }).notNull().unique(),
  avatar: text("avatar"),
  role: varchar("role", { length: 20 }).default("user"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  status: agentStatusEnum("status").default("idle"),
  model: varchar("model", { length: 50 }).default("sonnet-4.6"),
  task: text("task"),
  progress: integer("progress").default(0),
  output: text("output"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const mcpServers = pgTable("mcp_servers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  authType: varchar("auth_type", { length: 50 }).default("oauth"),
  status: mcpStatusEnum("status").default("disconnected"),
  latency: integer("latency").default(0),
  url: varchar("url", { length: 255 }),
  version: varchar("version", { length: 20 }),
  requestsCount: bigint("requests_count", { mode: "number" }).default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  dealId: varchar("deal_id", { length: 50 }).notNull().unique(),
  property: varchar("property", { length: 200 }).notNull(),
  type: varchar("type", { length: 50 }),
  area: varchar("area", { length: 100 }),
  priceAed: bigint("price_aed", { mode: "number" }).notNull(),
  score: integer("score").default(0),
  tier: dealTierEnum("tier").default("LOW"),
  commission: real("commission"),
  status: dealStatusEnum("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 100 }),
  units: integer("units").default(0),
  totalValue: bigint("total_value", { mode: "number" }).default(0),
  rfmScore: integer("rfm_score").default(0),
  tier: contactTierEnum("tier").default("Loyal"),
  area: varchar("area", { length: 100 }),
  lastContact: timestamp("last_contact"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  template: varchar("template", { length: 100 }),
  language: varchar("language", { length: 50 }).default("English"),
  sent: integer("sent").default(0),
  delivered: integer("delivered").default(0),
  opened: integer("opened").default(0),
  status: campaignStatusEnum("status").default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  status: videoStatusEnum("status").default("pending"),
  platform: varchar("platform", { length: 50 }),
  progress: integer("progress").default(0),
  duration: integer("duration"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const signalAlerts = pgTable("signal_alerts", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 50 }).notNull(),
  severity: signalSeverityEnum("severity").default("low"),
  message: text("message").notNull(),
  source: varchar("source", { length: 100 }),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const deployedAgents = pgTable("deployed_agents", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  template: varchar("template", { length: 50 }),
  status: deployedStatusEnum("status").default("idle"),
  target: varchar("target", { length: 100 }),
  lastRun: timestamp("last_run"),
  createdAt: timestamp("created_at").defaultNow(),
});
