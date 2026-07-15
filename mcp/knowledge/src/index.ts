// sahiix-knowledge-mcp — stdio MCP server exposing the SAHIIX Documents archive
// (Neon Postgres FTS) + the RERA/NEXUS playbook files as tools/resources/prompts,
// so Claude Code (and Jarvis via a future tool) can browse real-estate knowledge.
//
// Pattern mirrors gentleman-book-mcp (mcp-go) but in TypeScript, reusing the
// sahiixx-os lib directly — getDb / chatComplete / extractJson / applyRules /
// the documents schema + demo fallback — so there is zero SQL/LLM duplication.
// Loads ../../.env into process.env first; api/lib/env getters then read the same
// DATABASE_URL / OLLAMA_* / JARVIS_* vars the Hono app uses.
//
// Transport: stdio only. Run with `npm run mcp:knowledge` (tsx). Wire into Claude
// Code via .mcp.json (see README).

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Load .env FIRST so api/lib/env getters (lazy) resolve DATABASE_URL etc. ──
const __dirname = dirname(fileURLToPath(import.meta.url)); // .../mcp/knowledge/src
const REPO_ROOT = resolve(__dirname, "../../..");           // sahiixx-os
config({ path: resolve(REPO_ROOT, ".env") });

import { loadPlaybooks, type Playbook } from "./playbooks";
import {
  askRera, searchDocuments, listDocuments, getDocument, listDocTypes, extractMetadata,
} from "./rag";

const PLAYBOOKS_DIR = process.env.RERA_PLAYBOOKS_DIR ?? homedir();
const playbooks: Playbook[] = loadPlaybooks(PLAYBOOKS_DIR);
const bySlug = new Map(playbooks.map((p) => [p.slug, p]));

if (!playbooks.length) {
  console.error(`[sahiix-knowledge] WARNING: no playbooks found in ${PLAYBOOKS_DIR}. Set RERA_PLAYBOOKS_DIR.`);
}

const server = new McpServer({ name: "sahiix-knowledge", version: "1.0.0" });

// ── Tools ─────────────────────────────────────────────────────────────────────
server.tool(
  "list_playbooks",
  "List all RERA/NEXUS playbooks (markdown files + palm-owners JSON export).",
  {},
  async () => ({
    content: [{ type: "text" as const, text: JSON.stringify(playbooks.map((p) => ({
      slug: p.slug, title: p.title, purpose: p.purpose, kind: p.kind, size: p.size,
    })), null, 2) }],
  }),
);

server.tool(
  "read_playbook",
  "Read a full playbook by slug.",
  { slug: z.string().describe("playbook slug, e.g. rera-compliance-note (see list_playbooks)") },
  async ({ slug }) => {
    const p = bySlug.get(slug);
    if (!p) return { content: [{ type: "text" as const, text: `No playbook named '${slug}'.` }], isError: true };
    return { content: [{ type: "text" as const, text: p.content }] };
  },
);

server.tool(
  "search_playbooks",
  "Keyword search across the RERA/NEXUS playbooks (substring per word, ranked, capped at 20).",
  { query: z.string().describe("free-text query") },
  async ({ query }) => {
    const { searchPlaybooks } = await import("./playbooks");
    const hits = searchPlaybooks(query, playbooks, 20);
    return { content: [{ type: "text" as const, text: JSON.stringify(hits, null, 2) }] };
  },
);

server.tool(
  "list_documents",
  "List archived documents (Neon; falls back to seeded demo store on DB error).",
  { type: z.string().optional().describe("optional doc_type filter: contract|offer|listing|id|letter|report|other") },
  async ({ type }) => {
    const rows = await listDocuments(type);
    return { content: [{ type: "text" as const, text: JSON.stringify(rows.map((d) => ({
      id: d.id, sourceName: d.sourceName, docType: d.docType, title: d.title, docDate: d.docDate, tags: d.tags,
    })), null, 2) }] };
  },
);

server.tool(
  "search_documents",
  "Postgres full-text search over archived documents (websearch_to_tsquery + ts_headline + ts_rank_cd; demo substring fallback).",
  { query: z.string(), type: z.string().optional() },
  async ({ query, type }) => {
    const hits = await searchDocuments(query, type, 50);
    return { content: [{ type: "text" as const, text: JSON.stringify(hits, null, 2) }] };
  },
);

server.tool(
  "get_document",
  "Fetch one archived document by id (full row incl. OCR text + LLM metadata).",
  { id: z.number() },
  async ({ id }) => {
    const d = await getDocument(id);
    if (!d) return { content: [{ type: "text" as const, text: `No document id ${id}.` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] };
  },
);

server.tool(
  "list_doc_types",
  "List document types + matching rules (the facets used by the Documents module).",
  {},
  async () => {
    const r = await listDocTypes();
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  },
);

server.tool(
  "ask_rera",
  "RAG: answer a RERA / Dubai real-estate question using playbooks + archived docs as grounded context (via the active Ollama Cloud provider).",
  { question: z.string() },
  async ({ question }) => {
    const answer = await askRera(question, playbooks);
    return { content: [{ type: "text" as const, text: answer }] };
  },
);

server.tool(
  "extract_metadata",
  "Extract structured metadata (title, docType, docDate, summary, parties/amounts/dates/propertyRefs/jurisdiction) from OCR'd document text. Reuses the documents module's matching rules + LLM extract.",
  { ocr_text: z.string(), source_name: z.string() },
  async ({ ocr_text, source_name }) => {
    const r = await extractMetadata(ocr_text, source_name);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  },
);

// ── Resources (static, read from disk at startup) ─────────────────────────────
server.resource(
  "playbooks-index",
  "rera://playbooks",
  { description: "Index of all RERA/NEXUS playbooks", mimeType: "application/json" },
  async () => ({
    contents: [{
      uri: "rera://playbooks",
      mimeType: "application/json",
      text: JSON.stringify(playbooks.map((p) => ({ slug: p.slug, title: p.title, purpose: p.purpose, kind: p.kind, size: p.size })), null, 2),
    }],
  }),
);

for (const p of playbooks) {
  const uri = `rera://playbooks/${p.slug}`;
  const mimeType = p.kind === "json" ? "application/json" : "text/markdown";
  server.resource(`playbook-${p.slug}`, uri, { description: p.purpose, mimeType }, async () => ({
    contents: [{ uri, mimeType, text: p.content }],
  }));
}

// ── Prompts ───────────────────────────────────────────────────────────────────
server.prompt(
  "rera_qa",
  "Answer a RERA/Dubai real-estate question with grounded citations from the playbooks + document archive.",
  { question: z.string() },
  async ({ question }) => ({
    messages: [{ role: "user" as const, content: { type: "text" as const, text:
      `Use the list_playbooks / search_playbooks / search_documents tools to gather context, then answer this question with source citations: ${question}` } }],
  }),
);

server.prompt(
  "summarize_playbook",
  "Summarize a RERA/NEXUS playbook into key rules + actionable steps.",
  { slug: z.string().describe("playbook slug (see list_playbooks)") },
  async ({ slug }) => {
    const p = bySlug.get(slug);
    const body = p ? p.content : `(playbook '${slug}' not found — call list_playbooks for the slugs)`;
    return { messages: [{ role: "user" as const, content: { type: "text" as const, text:
      `Summarize the following RERA/NEXUS playbook into the key rules + actionable steps:\n\n${body}` } }] };
  },
);

// ── Boot (stdio) ──────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);