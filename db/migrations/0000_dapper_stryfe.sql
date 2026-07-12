CREATE TYPE "public"."agent_status" AS ENUM('online', 'busy', 'error', 'idle');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'sending', 'sent', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."contact_tier" AS ENUM('Champions', 'Top', 'Loyal', 'At Risk');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('active', 'pending', 'closed', 'lost');--> statement-breakpoint
CREATE TYPE "public"."deal_tier" AS ENUM('HARD', 'MEDIUM', 'LOW', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."deployed_status" AS ENUM('active', 'idle', 'error', 'deploying');--> statement-breakpoint
CREATE TYPE "public"."mcp_status" AS ENUM('connected', 'warning', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."signal_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('generating', 'editing', 'pending', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" "agent_status" DEFAULT 'idle',
	"model" varchar(50) DEFAULT 'sonnet-4.6',
	"task" text,
	"progress" integer DEFAULT 0,
	"output" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"template" varchar(100),
	"language" varchar(50) DEFAULT 'English',
	"sent" integer DEFAULT 0,
	"delivered" integer DEFAULT 0,
	"opened" integer DEFAULT 0,
	"status" "campaign_status" DEFAULT 'draft',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone" varchar(30),
	"email" varchar(100),
	"units" integer DEFAULT 0,
	"total_value" bigint DEFAULT 0,
	"rfm_score" integer DEFAULT 0,
	"tier" "contact_tier" DEFAULT 'Loyal',
	"area" varchar(100),
	"last_contact" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" varchar(50) NOT NULL,
	"property" varchar(200) NOT NULL,
	"type" varchar(50),
	"area" varchar(100),
	"price_aed" bigint NOT NULL,
	"score" integer DEFAULT 0,
	"tier" "deal_tier" DEFAULT 'LOW',
	"commission" real,
	"status" "deal_status" DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "deals_deal_id_unique" UNIQUE("deal_id")
);
--> statement-breakpoint
CREATE TABLE "deployed_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"template" varchar(50),
	"status" "deployed_status" DEFAULT 'idle',
	"target" varchar(100),
	"last_run" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"auth_type" varchar(50) DEFAULT 'oauth',
	"status" "mcp_status" DEFAULT 'disconnected',
	"latency" integer DEFAULT 0,
	"url" varchar(255),
	"version" varchar(20),
	"requests_count" bigint DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signal_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(50) NOT NULL,
	"severity" "signal_severity" DEFAULT 'low',
	"message" text NOT NULL,
	"source" varchar(100),
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100),
	"email" varchar(100) NOT NULL,
	"avatar" text,
	"role" varchar(20) DEFAULT 'user',
	"password_hash" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" "video_status" DEFAULT 'pending',
	"platform" varchar(50),
	"progress" integer DEFAULT 0,
	"duration" integer,
	"created_at" timestamp DEFAULT now()
);
