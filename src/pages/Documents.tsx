import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Search, FileText, RefreshCw } from "lucide-react";
import { ocrFile } from "@/lib/ocr";
import { trpc } from "@/providers/trpc";
import {
  useDocumentList, useDocumentSearch, useDocumentTypes,
  useDocumentIngest, useDocumentReextract, useDocumentRuleCreate,
} from "@/hooks/useSahiixxData";

type DocType = "contract" | "offer" | "listing" | "id" | "letter" | "report" | "other";
const DOC_TYPES: DocType[] = ["contract", "offer", "listing", "id", "letter", "report", "other"];

const TYPE_BADGE: Record<DocType, { color: string; label: string }> = {
  contract: { color: "#FF1A1A", label: "CONTRACT" },
  offer: { color: "#FF9500", label: "OFFER" },
  listing: { color: "#0088FF", label: "LISTING" },
  id: { color: "#00DD77", label: "ID/DEED" },
  letter: { color: "#FFAA00", label: "LETTER" },
  report: { color: "#00CCFF", label: "REPORT" },
  other: { color: "#555555", label: "OTHER" },
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** ts_headline wraps matches in <b></b>. Escape everything, then re-introduce
 *  only <b>/</b> — so the only tags in the final string are the ones we allow. */
function highlightSnippet(html: string): { __html: string } {
  const escaped = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const restored = escaped.replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
  return { __html: restored };
}

export default function Documents() {
  const utils = trpc.useUtils();
  const types = useDocumentTypes();
  const ingest = useDocumentIngest();
  const reextract = useDocumentReextract();
  const ruleCreate = useDocumentRuleCreate();

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocType | "">("");
  const search = useDocumentSearch(q, typeFilter || undefined);
  const list = useDocumentList(typeFilter || undefined);

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [ingestErr, setIngestErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // rule form
  const [rule, setRule] = useState({
    algorithm: "keyword" as "keyword" | "regex" | "fuzzy",
    expression: "",
    target: "type" as "type" | "tag",
    targetValue: "",
  });
  function setRuleK<K extends keyof typeof rule>(k: K, v: (typeof rule)[K]) {
    setRule((r) => ({ ...r, [k]: v }));
  }

  const results = q.trim().length > 0 ? (search.data ?? []) : (list.data ?? []);
  const isSearch = q.trim().length > 0;

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setIngestErr(null);
    setBusy(true);
    try {
      for (const file of arr) {
        setProgress(0);
        setProgressLabel(`OCR ${file.name}`);
        const ocrText = await ocrFile(file, (p, label) => {
          setProgress(p);
          setProgressLabel(label);
        });
        if (!ocrText.trim()) {
          setIngestErr(`No text extracted from ${file.name}.`);
          continue;
        }
        await ingest.mutateAsync({
          sourceName: file.name,
          ocrText,
        });
      }
      utils.documents.list.invalidate();
    } catch (e: any) {
      setIngestErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setProgress(0);
      setProgressLabel("");
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  async function onRuleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!rule.expression.trim() || !rule.targetValue.trim()) return;
    await ruleCreate.mutateAsync({
      algorithm: rule.algorithm,
      expression: rule.expression.trim(),
      target: rule.target,
      targetValue: rule.targetValue.trim(),
    });
    setRule({ algorithm: "keyword", expression: "", target: "type", targetValue: "" });
  }

  const rules = types.data?.rules ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-2xl tracking-widest text-documents">DOCUMENTS</h1>
        <span className="font-mono text-xs text-text-muted">OCR · LLM extract · full-text search</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* left column: upload + rules */}
        <div className="space-y-6">
          {/* dropzone */}
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">INGEST</h2>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-documents bg-documents/10" : "border-surface-hover hover:border-documents/60"
              }`}
            >
              <Upload className="w-6 h-6 mx-auto mb-2 text-documents" />
              <div className="font-mono text-xs text-text-secondary">
                {busy ? progressLabel : "drop a PDF / image here, or click to browse"}
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>

            {busy && (
              <div className="mt-3">
                <div className="h-1.5 bg-text-dim rounded overflow-hidden">
                  <div className="h-full bg-documents transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="font-mono text-[10px] text-text-muted mt-1">{Math.round(progress * 100)}% · OCR runs in your browser (eng+ara)</div>
              </div>
            )}
            {ingestErr && (
              <div className="mt-3 font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2">{ingestErr}</div>
            )}
            {ingest.isPending && !busy && (
              <div className="mt-3 font-mono text-xs text-text-muted">extracting metadata via LLM…</div>
            )}
          </div>

          {/* matching rules */}
          <form onSubmit={onRuleCreate} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">MATCHING RULE</h2>
            <p className="font-mono text-[10px] text-text-muted leading-relaxed">
              keyword: <code className="text-text-secondary">all offer to purchase</code> · <code className="text-text-secondary">any palm jumeirah</code>
              <br />regex: <code className="text-text-secondary">{"rera\\s+form\\s+[a-z]"}</code> · fuzzy: <code className="text-text-secondary">deposit~2</code>
            </p>
            <select value={rule.algorithm} onChange={(e) => setRuleK("algorithm", e.target.value as typeof rule.algorithm)}
              className="w-full bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-documents outline-none">
              <option value="keyword">keyword</option>
              <option value="regex">regex</option>
              <option value="fuzzy">fuzzy</option>
            </select>
            <input placeholder="expression" value={rule.expression} onChange={(e) => setRuleK("expression", e.target.value)}
              className="w-full bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-documents outline-none" />
            <div className="grid grid-cols-2 gap-2">
              <select value={rule.target} onChange={(e) => setRuleK("target", e.target.value as typeof rule.target)}
                className="bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-documents outline-none">
                <option value="type">→ type</option>
                <option value="tag">→ tag</option>
              </select>
              <input placeholder={rule.target === "type" ? "doc type" : "tag"} value={rule.targetValue} onChange={(e) => setRuleK("targetValue", e.target.value)}
                className="bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-documents outline-none" />
            </div>
            <button type="submit" disabled={ruleCreate.isPending || !rule.expression.trim() || !rule.targetValue.trim()}
              className="w-full bg-documents text-black font-mono text-sm tracking-widest py-2 rounded hover:brightness-110 transition disabled:opacity-40">
              {ruleCreate.isPending ? "SAVING…" : "ADD RULE"}
            </button>
          </form>

          {/* rules list */}
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-2">RULES ({rules.length})</h2>
            <div className="space-y-1.5 max-h-48 overflow-auto">
              {rules.length === 0 && <div className="font-mono text-xs text-text-muted">no rules</div>}
              {rules.map((r) => (
                <div key={r.id} className="font-mono text-[10px] text-text-secondary flex gap-2">
                  <span className="text-documents">{r.algorithm}</span>
                  <span className="truncate">{r.expression}</span>
                  <span className="text-text-muted ml-auto shrink-0">→ {r.targetValue}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right column: search + results */}
        <div className="lg:col-span-2">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <h2 className="font-display text-sm tracking-widest text-text-secondary">
                {isSearch ? "SEARCH RESULTS" : "ALL DOCUMENTS"} ({results.length})
              </h2>
              <div className="flex items-center gap-2 ml-auto">
                <Search className="w-3.5 h-3.5 text-text-muted" />
                <input
                  placeholder="search document text…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="bg-void border border-surface-hover rounded px-3 py-1.5 font-mono text-xs text-text-primary focus:border-documents outline-none w-48"
                />
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DocType | "")}
                  className="bg-void border border-surface-hover rounded px-2 py-1.5 font-mono text-xs text-text-primary focus:border-documents outline-none">
                  <option value="">all types</option>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{TYPE_BADGE[t].label}</option>)}
                </select>
              </div>
            </div>

            {(isSearch ? search.error : list.error) && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2 mb-3">
                {(isSearch ? search.error : list.error)?.message}
              </div>
            )}

            {results.length === 0 && !(isSearch ? search.error : list.error) && (
              <div className="font-mono text-xs text-text-muted py-8 text-center">
                {isSearch ? "no matches" : "no documents — drop one above to start"}
              </div>
            )}

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {results.map((d: any) => {
                  const dt = (d.docType ?? "other") as DocType;
                  const badge = TYPE_BADGE[dt];
                  const snippet = isSearch ? d.snippet : null;
                  return (
                    <motion.div key={d.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                      className="border border-surface-hover bg-void rounded px-3 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FileText className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span className="font-mono text-sm text-text-primary">{d.title ?? d.sourceName}</span>
                        <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded border"
                          style={{ color: badge.color, borderColor: `${badge.color}66` }}>{badge.label}</span>
                        <span className="font-mono text-[10px] text-text-muted ml-auto">{fmtDate(d.docDate)}</span>
                        <button
                          onClick={() => reextract.mutate({ id: d.id })}
                          disabled={reextract.isPending}
                          title="Re-run LLM extract on stored text"
                          className="font-mono text-[10px] text-text-muted hover:text-documents transition disabled:opacity-40">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      </div>
                      {d.summary && (
                        <div className="font-mono text-[11px] text-text-secondary mt-1">{d.summary}</div>
                      )}
                      {snippet && (
                        <div className="font-mono text-[11px] text-text-secondary mt-1 leading-relaxed line-clamp-2"
                          dangerouslySetInnerHTML={highlightSnippet(snippet)} />
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="font-mono text-[10px] text-text-muted">{d.sourceName}</span>
                        {d.tags && d.tags.length > 0 && d.tags.map((t: string) => (
                          <span key={t} className="font-mono text-[10px] text-documents border border-documents/30 rounded px-1 py-0.5">{t}</span>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}