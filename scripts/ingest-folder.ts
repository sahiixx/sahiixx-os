// Phase-2a bulk importer for the documents module — DRY-RUN INVENTORY in this pass.
//
// The documents module's `ingest` procedure is OCR-source-agnostic: it accepts
// already-OCR'd text. The browser seam (src/lib/ocr.ts) does OCR client-side via
// tesseract.js + pdf.js, both dynamically imported so they never touch the
// Worker bundle. A *bulk* importer for the F:\ archive can't use the browser
// seam, so phase-2a is a Node/tsx script that walks a folder and feeds the same
// `documents.ingest` seam.
//
// This pass ships ONLY the dry-run inventory scanner — the prerequisite that
// tells you what's actually in a root (counts, bytes, extensions, largest
// files, heaviest dirs) before any OCR or ingest. It is read-only, uses only
// node:fs (no pdfjs/tesseract in Node yet — that's the heavy path), and is safe
// to run against F:\ without a confirmation step.
//
// The heavier modes (--probe-text / --ingest / --ocr) are wired in the CLI so
// the interface is stable, but exit with a clear "not implemented in this pass"
// message — extracting text from PDFs in Node needs the pdfjs-dist legacy build
// + a worker setup, and image OCR needs tesseract.js's Node path (which pulls
// language traineddata from a CDN on first use). Both are real work and belong
// in a follow-up, not half-shipped here. See the plan file
// (recursive-drifting-key.md, phase 2) for the intended shape.
//
// Run:  npx tsx scripts/ingest-folder.ts <root> [--ext pdf,png,...] [--limit 50] [--json] [--quiet]
//       npx tsx scripts/ingest-folder.ts F:\ALL_MY_FILES --limit 100 --quiet

import { opendir } from "node:fs/promises";
import { extname, basename, dirname, relative } from "node:path";
import { resolve } from "node:path";

const DEFAULT_EXTS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "webp"];

// Dir basenames never treated as documents — dev/cache junk that would swamp any
// repo-root scan and add nothing to a real F:\ archive. Pruned during the walk.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__",
  ".pytest_cache", ".ruff_cache", ".mypy_cache", ".superpowers",
  ".next", ".turbo", ".cache",
]);

interface Opts {
  root: string;
  exts: Set<string>;
  limit: number;
  json: boolean;
  quiet: boolean;
  mode: "dry-run" | "probe-text" | "ingest" | "ocr";
  api: string;
  email: string | undefined;
  password: string | undefined;
}

function parseArgs(argv: string[]): Opts {
  const args = argv.slice(2);
  const opts: Opts = {
    root: "",
    exts: new Set(DEFAULT_EXTS),
    limit: 50,
    json: false,
    quiet: false,
    mode: "dry-run",
    api: "http://localhost:3000",
    email: undefined,
    password: undefined,
  };
  const setFlags = new Set<string>(["--json", "--quiet", "--probe-text", "--ingest", "--ocr"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (setFlags.has(a)) {
      if (a === "--json") opts.json = true;
      else if (a === "--quiet") opts.quiet = true;
      else if (a === "--probe-text") opts.mode = "probe-text";
      else if (a === "--ingest") opts.mode = "ingest";
      else if (a === "--ocr") opts.mode = "ocr";
    } else if (a === "--ext" && args[i + 1]) {
      opts.exts = new Set(args[++i].split(",").map((s) => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean));
    } else if (a === "--limit" && args[i + 1]) {
      opts.limit = Math.max(0, parseInt(args[++i], 10) || 0);
    } else if (a === "--api" && args[i + 1]) {
      opts.api = args[++i];
    } else if (a === "--email" && args[i + 1]) {
      opts.email = args[++i];
    } else if (a === "--password" && args[i + 1]) {
      opts.password = args[++i];
    } else if (!a.startsWith("--") && !opts.root) {
      opts.root = a;
    } else if (!a.startsWith("--")) {
      // ignore extra positional args
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a} (see --help)`);
      process.exit(2);
    }
  }
  if (!opts.root) {
    printHelp();
    process.exit(2);
  }
  return opts;
}

function printHelp(): void {
  console.log(`ingest-folder — documents module bulk importer (dry-run inventory in this pass)

usage: npx tsx scripts/ingest-folder.ts <root> [options]

  <root>                   folder to walk recursively
  --ext <a,b,c>            extensions to include (default: ${DEFAULT_EXTS.join(",")})
  --limit <N>              cap files listed in detail (default 50; counts are always exact)
  --json                   emit machine-readable JSON instead of the text report
  --quiet                  summary only, no per-file listing

  --probe-text             (stub) classify PDFs as text vs scanned via pdfjs
  --ingest                 (stub) extract text + POST documents.ingest
  --ocr                    (stub) OCR scanned PDFs + images via tesseract.js
  --api <url>              API base for --ingest (default http://localhost:3000)
  --email <e> / --password <p>   auth creds for --ingest

In this pass only the default dry-run scan is implemented; the --probe-text /
--ingest / --ocr modes exit with a clear "not implemented" message. Read-only,
safe to run against large archives.`);
}

interface FileEntry {
  path: string;
  ext: string;
  bytes: number;
}

interface ScanReport {
  root: string;
  extensions: string[];
  totalFiles: number;
  totalBytes: number;
  byExt: Record<string, { count: number; bytes: number }>;
  byDir: { dir: string; count: number; bytes: number }[];
  largest: FileEntry[];
  dirErrors: number;
  errors: string[];
}

// Bounded top-N largest-files tracker (avoids sorting the whole archive).
class TopN {
  private items: FileEntry[] = [];
  constructor(private readonly n: number) {}
  add(f: FileEntry): void {
    if (this.items.length < this.n) {
      this.items.push(f);
      this.bubbleUp();
    } else if (f.bytes > this.items[0].bytes) {
      this.items[0] = f;
      this.bubbleDown();
    }
  }
  // keep items[0] as the min of the set (min-heap of size n → top-n largest)
  private bubbleUp(): void {
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[i].bytes < this.items[p].bytes) { [this.items[i], this.items[p]] = [this.items[p], this.items[i]]; i = p; }
      else break;
    }
  }
  private bubbleDown(): void {
    let i = 0;
    const n = this.items.length;
    while (true) {
      const l = i * 2 + 1, r = l + 1; let smallest = i;
      if (l < n && this.items[l].bytes < this.items[smallest].bytes) smallest = l;
      if (r < n && this.items[r].bytes < this.items[smallest].bytes) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
  sorted(): FileEntry[] {
    return [...this.items].sort((a, b) => b.bytes - a.bytes);
  }
}

async function scan(root: string, exts: Set<string>, limit: number): Promise<ScanReport> {
  const byExt: Record<string, { count: number; bytes: number }> = {};
  const byDirAcc = new Map<string, { count: number; bytes: number }>();
  const top = new TopN(limit || 0);
  let totalFiles = 0;
  let totalBytes = 0;
  let dirErrors = 0;
  const errors: string[] = [];

  // Streaming recursive walk via opendir — constant memory, survives huge trees.
  async function walk(dir: string): Promise<void> {
    let handle;
    try {
      handle = await opendir(dir);
    } catch (e: any) {
      dirErrors++;
      errors.push(`${dir}: ${e?.code ?? "opendir error"}`);
      return;
    }
    for await (const ent of handle) {
      const full = dir + (dir.endsWith("\\") || dir.endsWith("/") ? "" : "\\") + ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
        await walk(full);
      } else if (ent.isFile()) {
        const ext = extname(ent.name).slice(1).toLowerCase();
        if (!exts.has(ext)) continue;
        // dirent.size is not always populated on all platforms; stat lazily.
        let bytes = (ent as any).size ?? 0;
        if (!bytes) {
          try { const st = await import("node:fs/promises").then((m) => m.stat(full)); bytes = st.size; }
          catch { bytes = 0; }
        }
        totalFiles++; totalBytes += bytes;
        byExt[ext] ??= { count: 0, bytes: 0 };
        byExt[ext].count++; byExt[ext].bytes += bytes;
        const d = dirname(full);
        let bd = byDirAcc.get(d);
        if (!bd) { bd = { count: 0, bytes: 0 }; byDirAcc.set(d, bd); }
        bd.count++; bd.bytes += bytes;
        top.add({ path: full, ext, bytes });
      }
    }
  }

  await walk(root);

  const byDir = [...byDirAcc.entries()]
    .map(([dir, v]) => ({ dir: relative(root, dir) || ".", count: v.count, bytes: v.bytes }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    root, extensions: [...exts], totalFiles, totalBytes,
    byExt, byDir, largest: top.sorted(), dirErrors, errors: errors.slice(0, 20),
  };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function printTextReport(r: ScanReport, opts: Opts): void {
  console.log(`ingest-folder dry-run — ${r.root}`);
  console.log(`extensions: ${r.extensions.join(", ")}`);
  console.log(`files: ${r.totalFiles.toLocaleString()}   total: ${fmtBytes(r.totalBytes)}   dir open errors: ${r.dirErrors}`);
  console.log("");
  console.log("by extension:");
  const extRows = Object.entries(r.byExt).sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [ext, v] of extRows) {
    console.log(`  .${ext.padEnd(6)} ${String(v.count).padStart(8)}   ${fmtBytes(v.bytes).padStart(10)}`);
  }
  console.log("");
  console.log("heaviest dirs (top 15):");
  for (const d of r.byDir) {
    console.log(`  ${String(d.count).padStart(7)}  ${fmtBytes(d.bytes).padStart(10)}  ${d.dir}`);
  }
  if (!opts.quiet && r.largest.length) {
    console.log("");
    console.log(`largest files (top ${r.largest.length}):`);
    for (const f of r.largest) {
      console.log(`  ${fmtBytes(f.bytes).padStart(10)}  ${f.path}`);
    }
  }
  if (r.errors.length) {
    console.log("");
    console.log(`scan errors (first ${r.errors.length}):`);
    for (const e of r.errors) console.log(`  ${e}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.mode === "probe-text") {
    console.error("--probe-text is not implemented in this pass (needs pdfjs-dist legacy build + Node worker setup).");
    console.error("See scripts/ingest-folder.ts header + plan file (recursive-drifting-key.md, phase 2a).");
    process.exit(3);
  }
  if (opts.mode === "ingest" || opts.mode === "ocr") {
    console.error(`--${opts.mode} is not implemented in this pass.`);
    console.error("Ingest needs: login → per-file text extract (text-PDFs) or OCR (scanned-PDFs/images) → POST documents.ingest.");
    console.error("OCR-in-Node pulls tesseract.js + language traineddata from a CDN on first use; build it deliberately in a follow-up.");
    process.exit(3);
  }

  const root = resolve(opts.root);
  const report = await scan(root, opts.exts, opts.limit);
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printTextReport(report, opts);
  }
}

main().catch((e) => {
  console.error("ingest-folder failed:", e?.stack ?? e);
  process.exit(1);
});