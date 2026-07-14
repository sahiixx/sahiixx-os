// Documents module tRPC router — searchable document archive (OCR + LLM + FTS).
// Reads are publicProcedure; writes (ingest/reextract/ruleCreate) are
// protectedProcedure (JWT-gated), matching the repo convention.
//
// Every procedure wraps its DB call in try/catch and falls back to the seeded
// demo store (demoDocuments/demoRules/demoDocTypes) so the UI is fully
// interactive with no Neon / no LLM provider — same pattern as sahiixx-router.
//
// FTS uses Postgres native: websearch_to_tsquery + ts_headline + ts_rank_cd
// against the generated `fts` tsvector column (GIN-indexed). This is the first
// FTS surface in the repo; contactSearch uses like() substring.

import { z } from "zod";
import { sql, eq, desc } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "./context";
import { getDb } from "./queries/connection";
import { documents, documentTypes, matchingRules } from "@db/schema";
import { chatComplete, extractJson } from "./lib/llm";
import { applyRules, type MatchingRule } from "./lib/matching";
import {
  demoDocuments, demoDocTypes, demoRules, addDemoDocument, addDemoRule,
  type DocumentRow, type DocumentTypeRow, type MatchingRuleRow,
} from "./queries/demo-data";

const DOC_TYPES = ["contract", "offer", "listing", "id", "letter", "report", "other"] as const;

const EXTRACT_SYSTEM =
  "You extract structured metadata from OCR'd real-estate documents (Dubai/UAE context). " +
  'Respond with a SINGLE JSON object, no prose, with keys: ' +
  '"title" (string — concise document title), ' +
  '"docType" (one of: contract, offer, listing, id, letter, report, other — or null if unclear), ' +
  '"docDate" (ISO date string YYYY-MM-DD if a date is mentioned, else null), ' +
  '"summary" (string — one-sentence summary), ' +
  '"metadata" ({ "parties": string[], "amounts": string[], "dates": string[], "propertyRefs": string[], "jurisdiction": string }). ' +
  'If a field is unknown use null or an empty array. Keep amounts as written (e.g. "AED 28,500,000").';

const EXTRACT_USER = (text: string, sourceName: string) =>
  `Source file: ${sourceName}\n\nOCR text:\n${text.slice(0, 12000)}\n\nReturn the JSON object now.`;

interface ExtractResult {
  title: string | null;
  docType: string | null;
  docDate: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
}

/** Run the LLM metadata extraction; returns null on ANY failure (graceful). */
async function runExtract(ocrText: string, sourceName: string): Promise<ExtractResult | null> {
  try {
    const content = await chatComplete({
      json: true,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: EXTRACT_USER(ocrText, sourceName) },
      ],
    });
    const obj = extractJson(content);
    if (!obj) return null;
    return {
      title: typeof obj.title === "string" ? obj.title : null,
      docType: typeof obj.docType === "string" && (DOC_TYPES as readonly string[]).includes(obj.docType) ? obj.docType : null,
      docDate: typeof obj.docDate === "string" && obj.docDate ? obj.docDate : null,
      summary: typeof obj.summary === "string" ? obj.summary : null,
      metadata: obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : null,
    };
  } catch {
    return null;
  }
}

/** Parse a possibly-ISO date string into a Date for the timestamp column. */
function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface SearchHit {
  id: number;
  title: string | null;
  docType: string | null;
  docDate: Date | null;
  snippet: string;
  rank: number;
  tags: string[] | null;
}

export const documentsRouter = router({
  // ── list ───────────────────────────────────────────────────────────────────
  list: publicProcedure.input(z.object({ type: z.enum(DOC_TYPES).optional() }).optional()).query(
    async ({ input }): Promise<DocumentRow[]> => {
      try {
        const db = getDb();
        const q = db.select().from(documents).orderBy(desc(documents.createdAt));
        if (input?.type) {
          return await q.where(eq(documents.docType, input.type));
        }
        return await q;
      } catch {
        return [...demoDocuments]
          .filter((d) => !input?.type || d.docType === input.type)
          .sort((a, b) => (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime());
      }
    },
  ),

  // ── search (Postgres FTS, falls back to substring on demo) ──────────────────
  search: publicProcedure.input(z.object({ query: z.string(), type: z.enum(DOC_TYPES).optional() })).query(
    async ({ input }): Promise<SearchHit[]> => {
      const q = input.query.trim();
      if (!q) return [];
      try {
        const db = getDb();
        const typeFilter = input.type ? sql`AND doc_type = ${input.type}` : sql``;
        const res: any = await db.execute(sql`
          SELECT id, title, doc_type, doc_date, tags,
                 ts_headline('english', ocr_text, websearch_to_tsquery('english', ${q}),
                             'MaxWords=35, MinWords=12, ShortWord=1, HighlightAll=1') AS snippet,
                 ts_rank_cd(fts, websearch_to_tsquery('english', ${q})) AS rank
          FROM documents
          WHERE fts @@ websearch_to_tsquery('english', ${q}) ${typeFilter}
          ORDER BY rank DESC
          LIMIT 50
        `);
        // neon-http drizzle returns either {rows} or the rows array depending on version
        const rows: any[] = Array.isArray(res) ? res : (res?.rows ?? []);
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          docType: r.doc_type,
          docDate: r.doc_date ? new Date(r.doc_date) : null,
          snippet: r.snippet,
          rank: Number(r.rank),
          tags: r.tags,
        }));
      } catch {
        // demo fallback: substring across ocrText + title, naive ranking by hit count
        const ql = q.toLowerCase();
        return demoDocuments
          .filter((d) => !input.type || d.docType === input.type)
          .map((d) => {
            const hay = `${d.title ?? ""} ${d.ocrText ?? ""}`.toLowerCase();
            const hits = hay.split(ql).length - 1;
            if (hits <= 0) return null;
            const idx = hay.indexOf(ql);
            const start = Math.max(0, idx - 60);
            const snippet = d.ocrText.slice(start, start + 160);
            return {
              id: d.id, title: d.title, docType: d.docType, docDate: d.docDate,
              snippet, rank: hits, tags: d.tags,
            } as SearchHit;
          })
          .filter((x): x is SearchHit => x !== null)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 50);
      }
    },
  ),

  // ── get ─────────────────────────────────────────────────────────────────────
  get: publicProcedure.input(z.object({ id: z.number() })).query(
    async ({ input }): Promise<DocumentRow | null> => {
      try {
        const db = getDb();
        const rows = await db.select().from(documents).where(eq(documents.id, input.id));
        return rows[0] ?? null;
      } catch {
        return demoDocuments.find((d) => d.id === input.id) ?? null;
      }
    },
  ),

  // ── types + rules (facets) ──────────────────────────────────────────────────
  types: publicProcedure.query(
    async (): Promise<{ types: DocumentTypeRow[]; rules: MatchingRuleRow[] }> => {
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
    },
  ),

  // ── ingest (OCR-source-agnostic: accepts already-OCR'd text) ────────────────
  ingest: protectedProcedure.input(z.object({
    sourceName: z.string().min(1),
    sourcePath: z.string().optional(),
    ocrText: z.string().min(1),
    docType: z.enum(DOC_TYPES).optional(),
    tags: z.array(z.string()).optional(),
  })).mutation(async ({ input }): Promise<{ doc: DocumentRow; demo: boolean }> => {
    // 1) load rules + apply keyword/regex/fuzzy matching
    let rules: MatchingRule[] = demoRules;
    try {
      const db0 = getDb();
      const rrows = await db0.select().from(matchingRules);
      rules = rrows.map((r) => ({
        algorithm: r.algorithm, expression: r.expression, target: r.target, targetValue: r.targetValue,
      }));
    } catch {
      rules = demoRules;
    }
    const matched = applyRules(input.ocrText, rules);

    // 2) LLM metadata extract (graceful: null on failure)
    const extracted = await runExtract(input.ocrText, input.sourceName);

    // resolve final field values: explicit input > matched > LLM > default
    const docType = input.docType ?? matched.type ?? extracted?.docType ?? "other";
    const tags = Array.from(new Set([...(input.tags ?? []), ...(matched.tags ?? [])]));
    const title = extracted?.title ?? input.sourceName.replace(/\.[^.]+$/, "");
    const docDate = extracted?.docDate ? parseDate(extracted.docDate) : null;
    const summary = extracted?.summary ?? null;
    const metadata = extracted?.metadata ?? null;

    try {
      const db = getDb();
      const inserted = await db
        .insert(documents)
        .values({
          sourceName: input.sourceName,
          sourcePath: input.sourcePath ?? null,
          docType: docType as (typeof documents.$inferSelect)["docType"],
          title, docDate, summary,
          ocrText: input.ocrText,
          metadata: (metadata ?? null) as any,
          tags,
        })
        .returning();
      return { doc: inserted[0], demo: false };
    } catch {
      const doc = addDemoDocument({
        sourceName: input.sourceName,
        sourcePath: input.sourcePath ?? null,
        docType: docType as DocumentRow["docType"],
        title, docDate, summary,
        ocrText: input.ocrText,
        metadata: (metadata ?? null) as any,
        tags,
      });
      return { doc, demo: true };
    }
  }),

  // ── reextract (re-run LLM on stored ocrText — no re-OCR) ─────────────────────
  reextract: protectedProcedure.input(z.object({ id: z.number() })).mutation(
    async ({ input }): Promise<{ success: true; demo: boolean }> => {
      // load the row (DB or demo)
      let row: DocumentRow | null = null;
      let isDemo = false;
      try {
        const db0 = getDb();
        const rows = await db0.select().from(documents).where(eq(documents.id, input.id));
        row = rows[0] ?? null;
      } catch {
        row = demoDocuments.find((d) => d.id === input.id) ?? null;
        isDemo = true;
      }
      if (!row) throw new Error("document not found");

      // re-apply rules + LLM extract
      let rules: MatchingRule[] = demoRules;
      if (!isDemo) {
        try {
          const db0 = getDb();
          const rrows = await db0.select().from(matchingRules);
          rules = rrows.map((r) => ({ algorithm: r.algorithm, expression: r.expression, target: r.target, targetValue: r.targetValue }));
        } catch { rules = demoRules; }
      }
      const matched = applyRules(row.ocrText, rules);
      const extracted = await runExtract(row.ocrText, row.sourceName);
      const title = extracted?.title ?? row.title;
      const docDate = extracted?.docDate ? parseDate(extracted.docDate) : row.docDate;
      const summary = extracted?.summary ?? row.summary;
      const metadata = extracted?.metadata ?? (row.metadata as Record<string, unknown> | null);
      const docType = matched.type ?? extracted?.docType ?? row.docType;
      const tags = Array.from(new Set([...(row.tags ?? []), ...(matched.tags ?? [])]));

      if (isDemo) {
        if (row) {
          row.title = title; row.docDate = docDate; row.summary = summary;
          row.metadata = metadata as any; row.docType = docType as DocumentRow["docType"]; row.tags = tags;
        }
        return { success: true, demo: true };
      }
      try {
        const db = getDb();
        await db
          .update(documents)
          .set({ title, docDate, summary, metadata: metadata as any, docType: docType as DocumentRow["docType"], tags })
          .where(eq(documents.id, input.id));
        return { success: true, demo: false };
      } catch {
        return { success: true, demo: true };
      }
    },
  ),

  // ── ruleCreate (add a matching rule) ────────────────────────────────────────
  ruleCreate: protectedProcedure.input(z.object({
    algorithm: z.enum(["keyword", "regex", "fuzzy"]),
    expression: z.string().min(1),
    target: z.enum(["type", "tag"]),
    targetValue: z.string().min(1),
  })).mutation(async ({ input }): Promise<{ rule: MatchingRuleRow; demo: boolean }> => {
    try {
      const db = getDb();
      const inserted = await db.insert(matchingRules).values(input).returning();
      return { rule: inserted[0], demo: false };
    } catch {
      const rule = addDemoRule({
        algorithm: input.algorithm, expression: input.expression,
        target: input.target, targetValue: input.targetValue,
      });
      return { rule, demo: true };
    }
  }),
});