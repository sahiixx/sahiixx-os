// RERA / NEXUS playbook loader. The 5 markdown playbooks + the palm-owners JSON
// export live at the home root (RERA_PLAYBOOKS_DIR, default $HOME); this reads
// them once at server startup and serves them as static MCP resources + the
// keyword-search corpus for search_playbooks / ask_rera.
//
// Keyword search is ported from the gentleman-book-mcp parser.Search shape:
// per-word substring match, score = matchedWords / totalQueryWords, capped,
// with a ~200-char snippet around the first matched word.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

export interface Playbook {
  slug: string;
  title: string;
  purpose: string;
  size: number;
  content: string;
  kind: "markdown" | "json";
}

// The canonical playbook set (found at C:\Users\sahii on this box). Each is a
// read-only export of the WSL sahiix-estate app / RERA working notes — the MCP
// server never writes back to these.
const PLAYBOOK_FILES: { file: string; purpose: string }[] = [
  { file: "dld-off-market-sourcing.md", purpose: "DLD off-market sourcing methodology (Dubai-wide)" },
  { file: "palm-jumeirah-dld-playbook.md", purpose: "Palm Jumeirah + DLD off-market sourcing playbook" },
  { file: "palm-outreach-sequences.md", purpose: "Palm owner outreach sequence templates" },
  { file: "palm-deal-tracker-schema.md", purpose: "NEXUS deal tracker schema reference" },
  { file: "rera-compliance-note.md", purpose: "RERA regulatory compliance guidance" },
];

/** Load all playbooks present in `dir`. Missing files are skipped (not fatal). */
export function loadPlaybooks(dir: string): Playbook[] {
  const out: Playbook[] = [];
  for (const { file, purpose } of PLAYBOOK_FILES) {
    const p = join(dir, file);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    const slug = basename(file, extname(file));
    out.push({
      slug,
      title: deriveTitle(raw) ?? slug,
      purpose,
      size: raw.length,
      content: raw,
      kind: "markdown",
    });
  }
  // palm_owners JSON — the only structured-data export; served as a json resource.
  const owners = join(dir, "palm_owners_high_priority.json");
  if (existsSync(owners)) {
    const raw = readFileSync(owners, "utf8");
    out.push({
      slug: "palm-owners",
      title: "Palm Owners — High Priority",
      purpose: "High-priority Palm owner target list (NEXUS export)",
      size: raw.length,
      content: raw,
      kind: "json",
    });
  }
  return out;
}

function deriveTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

export interface PlaybookHit {
  slug: string;
  title: string;
  score: number;
  snippet: string;
}

/** Keyword search across the playbook corpus. Score = matched words / query words. */
export function searchPlaybooks(query: string, books: Playbook[], limit = 20): PlaybookHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: PlaybookHit[] = [];
  for (const b of books) {
    const hay = `${b.title}\n${b.content}`.toLowerCase();
    let matched = 0;
    let firstIdx = -1;
    for (const w of words) {
      const i = hay.indexOf(w);
      if (i >= 0) {
        matched++;
        if (firstIdx < 0 || i < firstIdx) firstIdx = i;
      }
    }
    if (matched === 0) continue;
    const start = Math.max(0, firstIdx - 100);
    const snippet = b.content.slice(start, start + 200).replace(/\s+/g, " ").trim();
    hits.push({ slug: b.slug, title: b.title, score: matched / words.length, snippet });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}