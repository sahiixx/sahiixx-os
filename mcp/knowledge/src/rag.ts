// Data + RAG layer for sahiix-knowledge-mcp. Reuses the sahiixx-os lib directly —
// getDb() (api/queries/connection), chatComplete/extractJson (api/lib/llm),
// applyRules (api/lib/matching), the documents/documentTypes/matchingRules
// schema handles (@db/schema), and the demoDocuments/demoDocTypes/demoRules
// fallback store (api/queries/demo-data). No SQL/LLM logic is duplicated from
// documents-router.ts — the FTS query block is the same parameterized raw SQL,
// and the LLM extract is the same chatComplete({json:true}) + extractJson call.
//
// Every read tries Neon first and falls back to the seeded demo store on ANY
// error (Neon unreachable / no DATABASE_URL), matching the router convention —
// so the MCP server is fully useful with zero DB.

import { sql, eq, desc } from "drizzle-orm";
import { getDb } from "../../../api/queries/connection";
import { chatComplete, extractJson } from "../../../api/lib/llm";
import { applyRules, type MatchingRule } from "../../../api/lib/matching";
import { documents, documentTypes, matchingRules } from "@db/schema";
import {
  demoDocuments, demoDocTypes, demoRules,
  type DocumentRow, type DocumentTypeRow, type MatchingRuleRow,
} from "../../../api/queries/demo-data";
import { searchPlaybooks, type Playbook, type PlaybookHit } from "./playbooks";

// ── Documents reads (mirror documents-router public procedures) ─────────────

export interface DocSearchHit {
  id: number;
  title: string | null;
  docType: string | null;
  snippet: string;
  rank: number;
}

/** Postgres FTS search (websearch_to_tsquery + ts_headline + ts_rank_cd). Demo substring fallback. */
export async function searchDocuments(query: string, type?: string, limit = 50): Promise<DocSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const db = getDb();
    const typeFilter = type ? sql`AND doc_type = ${type}` : sql``;
    const res: any = await db.execute(sql`
      SELECT id, title, doc_type,
             ts_headline('english', ocr_text, websearch_to_tsquery('english', ${q}),
                 'MaxWords=35, MinWords=12, ShortWord=1, HighlightAll=1') AS snippet,
             ts_rank_cd(fts, websearch_to_tsquery('english', ${q})) AS rank
      FROM documents
      WHERE fts @@ websearch_to_tsquery('english', ${q}) ${typeFilter}
      ORDER BY rank DESC
      LIMIT ${limit}
    `);
    const rows: any[] = Array.isArray(res) ? res : (res?.rows ?? []);
    return rows.map((r) => ({
      id: r.id, title: r.title, docType: r.doc_type, snippet: r.snippet, rank: Number(r.rank),
    }));
  } catch {
    const ql = q.toLowerCase();
    const out: DocSearchHit[] = [];
    for (const d of demoDocuments) {
      if (type && d.docType !== type) continue;
      const hay = `${d.title ?? ""} ${d.ocrText ?? ""}`.toLowerCase();
      const i = hay.indexOf(ql);
      if (i < 0) continue;
      const start = Math.max(0, i - 60);
      out.push({ id: d.id, title: d.title, docType: d.docType as string | null, snippet: d.ocrText.slice(start, start + 160), rank: 1 });
    }
    return out.slice(0, limit);
  }
}

export async function listDocuments(type?: string): Promise<DocumentRow[]> {
  try {
    const db = getDb();
    const q = db.select().from(documents).orderBy(desc(documents.createdAt));
    return type ? await q.where(eq(documents.docType, type as any)) : await q;
  } catch {
    return [...demoDocuments]
      .filter((d) => !type || d.docType === type)
      .sort((a, b) => (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime());
  }
}

export async function getDocument(id: number): Promise<DocumentRow | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(documents).where(eq(documents.id, id));
    return rows[0] ?? null;
  } catch {
    return demoDocuments.find((d) => d.id === id) ?? null;
  }
}

export async function listDocTypes(): Promise<{ types: DocumentTypeRow[]; rules: MatchingRuleRow[] }> {
  try {
    const db = getDb();
    const [types, rules] = await Promise.all([
      db.select().from(documentTypes),
      db.select().from(matchingRules).orderBy(desc(matchingRules.createdAt)),
    ]);
    return { types, rules };
  } catch {
    return { types: [...demoDocTypes], rules: [...demoRules] };
  }
}

// ── LLM metadata extract (ports documents-router runExtract + applyRules) ────

const EXTRACT_SYSTEM =
  "You extract structured metadata from OCR'd real-estate documents (Dubai/UAE context). " +
  'Respond with a SINGLE JSON object, no prose, with keys: ' +
  '"title" (string), "docType" (one of: contract, offer, listing, id, letter, report, other — or null), ' +
  '"docDate" (ISO date YYYY-MM-DD or null), "summary" (one-sentence string), ' +
  '"metadata" ({ "parties": string[], "amounts": string[], "dates": string[], "propertyRefs": string[], "jurisdiction": string }). ' +
  'If a field is unknown use null or an empty array. Keep amounts as written (e.g. "AED 28,500,000").';

const EXTRACT_USER = (text: string, sourceName: string) =>
  `Source file: ${sourceName}\n\nOCR text:\n${text.slice(0, 12000)}\n\nReturn the JSON object now.`;

export interface ExtractResult {
  matched: { type?: string; tags: string[] };
  extracted: Record<string, unknown> | null;
}

/** Apply matching rules + run the LLM metadata extract. Returns matched + extracted (null on LLM failure). */
export async function extractMetadata(ocrText: string, sourceName: string): Promise<ExtractResult> {
  let rules: MatchingRule[] = demoRules;
  try {
    const db = getDb();
    const rrows = await db.select().from(matchingRules);
    rules = rrows.map((r) => ({
      algorithm: r.algorithm, expression: r.expression, target: r.target, targetValue: r.targetValue,
    }));
  } catch {
    rules = demoRules;
  }
  const matched = applyRules(ocrText, rules);
  let extracted: Record<string, unknown> | null = null;
  try {
    const content = await chatComplete({
      json: true,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: EXTRACT_USER(ocrText, sourceName) },
      ],
    });
    extracted = extractJson(content);
  } catch {
    extracted = null;
  }
  return { matched, extracted };
}

// ── RAG: ask_rera — stuff playbook + document snippets as context ───────────

const RAG_SYSTEM =
  "You are a RERA / Dubai real-estate compliance and off-market sourcing assistant. " +
  "Answer the user's question using ONLY the provided context (playbook excerpts + archived " +
  "document snippets). For each factual claim, cite the source slug or document title in " +
  "parentheses, e.g. (rera-compliance-note) or (Offer to Purchase — Palm Jumeirah Villa). " +
  "If the context does not cover the question, say so plainly — do NOT invent RERA rules or " +
  "procedures. Keep it concise and actionable.";

export async function askRera(question: string, books: Playbook[]): Promise<string> {
  const pbHits = searchPlaybooks(question, books, 3);
  const docHits = await searchDocuments(question, undefined, 5);
  const ctx = buildContext(pbHits, docHits);
  const user =
    `Question: ${question}\n\n--- CONTEXT ---\n${ctx}\n--- END CONTEXT ---\n\n` +
    `Answer grounded only in the context above. Cite sources.`;
  try {
    return await chatComplete({
      messages: [
        { role: "system", content: RAG_SYSTEM },
        { role: "user", content: user },
      ],
    });
  } catch (e: any) {
    return `RAG failed (LLM unavailable): ${e?.message ?? String(e)}.\n\nRelevant context:\n${ctx}`;
  }
}

function buildContext(pbHits: PlaybookHit[], docHits: DocSearchHit[]): string {
  const parts: string[] = [];
  if (pbHits.length) {
    parts.push("## Playbook excerpts");
    for (const h of pbHits) parts.push(`### (${h.slug}) ${h.title}\n${h.snippet}`);
  }
  if (docHits.length) {
    parts.push("## Archived document snippets");
    for (const d of docHits)
      parts.push(`### (${d.title ?? "untitled"}) [doc id ${d.id}, type ${d.docType ?? "?"}]\n${d.snippet}`);
  }
  return parts.join("\n\n") || "(no relevant context found)";
}