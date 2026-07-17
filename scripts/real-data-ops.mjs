/**
 * Real-data ops (not seed theatre):
 *  1) Import live estate.db properties into Neon deals (PROP-estate-*)
 *  2) Purge synthetic operator/RW test rows (keep DXB seed + real estate imports)
 *  3) Optional: import leads CSV into WSL estate SQLite via POST /leads
 *  4) Optional: ingest Palm owners JSON (flagged template vs real by phone quality)
 *
 * Usage:
 *   node scripts/real-data-ops.mjs --all
 *   node scripts/real-data-ops.mjs --import-estate
 *   node scripts/real-data-ops.mjs --purge-synthetic
 *   node scripts/real-data-ops.mjs --import-leads path/to/leads.csv
 *   node scripts/real-data-ops.mjs --import-palm path/to/owners.json
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

function loadEnv() {
  for (const f of [".env", ".dev.vars"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim().replace(/^["']|["']$/g, "");
      v = v.replace(/^\uFEFF/, "");
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}

loadEnv();

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argVal = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL missing (.env / .dev.vars)");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: "require", max: 1 });

function readEstateDb() {
  // Python on WSL — no sqlite3 CLI required
  const py = `
import sqlite3, json
db = "/home/xx/projects/sahiix-estate/estate.db"
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
props = [dict(r) for r in cur.execute("SELECT * FROM properties ORDER BY id")]
leads = [dict(r) for r in cur.execute("SELECT * FROM leads ORDER BY id")]
print(json.dumps({"properties": props, "leads": leads}))
`;
  const r = spawnSync("wsl", ["-d", "Ubuntu-24.04", "--", "python3", "-c", py], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`estate.db read failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout.trim());
}

function scoreFromPrice(price) {
  const p = Number(price) || 0;
  if (p >= 10_000_000) return 85;
  if (p >= 5_000_000) return 72;
  if (p >= 2_000_000) return 60;
  return 45;
}

function tierFromScore(s) {
  if (s >= 80) return "HARD";
  if (s >= 60) return "MEDIUM";
  return "LOW";
}

async function importEstateInventory() {
  const { properties } = readEstateDb();
  console.log(`\n[import-estate] ${properties.length} properties from live estate.db`);
  let upserted = 0;
  for (const p of properties) {
    const dealId = `PROP-estate-${p.id}`;
    const score = scoreFromPrice(p.price);
    const tier = tierFromScore(score);
    const commission = Math.round(Number(p.price || 0) * 0.02);
    // Upsert by deal_id
    await sql`
      INSERT INTO deals (deal_id, property, type, area, price_aed, score, tier, commission, status, created_at)
      VALUES (
        ${dealId},
        ${p.title || `Property ${p.id}`},
        ${"inventory"},
        ${p.location || null},
        ${Number(p.price) || 0},
        ${score},
        ${tier},
        ${commission},
        ${p.status === "available" ? "active" : "pending"},
        NOW()
      )
      ON CONFLICT (deal_id) DO UPDATE SET
        property = EXCLUDED.property,
        type = EXCLUDED.type,
        area = EXCLUDED.area,
        price_aed = EXCLUDED.price_aed,
        score = EXCLUDED.score,
        tier = EXCLUDED.tier,
        commission = EXCLUDED.commission,
        status = EXCLUDED.status
    `;
    upserted++;
    console.log(`  + ${dealId} | ${p.title} | ${p.location} | AED ${p.price}`);
  }
  console.log(`[import-estate] upserted=${upserted}`);
  return upserted;
}

async function purgeSynthetic() {
  console.log("\n[purge-synthetic] removing operator/RW test rows (keeping DXB seed + PROP-estate-*)");
  const signals = await sql`
    DELETE FROM signal_alerts
    WHERE source IN ('operator', 'real-world-tasks')
       OR message ILIKE 'OPERATOR %'
       OR message ILIKE 'Real-world signal%'
    RETURNING id, source, message
  `;
  const campaigns = await sql`
    DELETE FROM campaigns
    WHERE name ILIKE 'OPERATOR %' OR name ILIKE 'RW Campaign%'
    RETURNING id, name
  `;
  const videos = await sql`
    DELETE FROM videos
    WHERE title ILIKE 'OPERATOR %' OR title ILIKE 'RW Video%'
    RETURNING id, title
  `;
  const deals = await sql`
    DELETE FROM deals
    WHERE deal_id LIKE 'RW-%' OR deal_id = 'ESTATE-1'
    RETURNING id, deal_id, property
  `;
  console.log(`  signals deleted: ${signals.length}`);
  for (const s of signals) console.log(`    - #${s.id} [${s.source}] ${String(s.message).slice(0, 70)}`);
  console.log(`  campaigns deleted: ${campaigns.length}`);
  for (const c of campaigns) console.log(`    - #${c.id} ${c.name}`);
  console.log(`  videos deleted: ${videos.length}`);
  for (const v of videos) console.log(`    - #${v.id} ${v.title}`);
  console.log(`  deals deleted: ${deals.length}`);
  for (const d of deals) console.log(`    - #${d.id} ${d.deal_id} ${d.property}`);
  return { signals: signals.length, campaigns: campaigns.length, videos: videos.length, deals: deals.length };
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // simple CSV split (quoted commas not fully supported — document that)
    const cols = lines[i].match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

async function importLeadsCsv(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`leads file not found: ${abs}`);
  const rows = parseCsv(readFileSync(abs, "utf8"));
  console.log(`\n[import-leads] ${rows.length} rows from ${abs}`);
  // Map flexible headers
  const norm = (r) => ({
    name: r.name || r.full_name || r.owner_name || r.contact || "",
    phone: r.phone || r.mobile || r.tel || "",
    email: r.email || r.mail || "",
    notes: r.notes || r.note || r.source || "csv-import",
    property_id: r.property_id ? Number(r.property_id) : null,
  });
  const estateUrl = process.env.ESTATE_API_URL || "http://127.0.0.1:3001";
  let ok = 0;
  let skip = 0;
  for (const raw of rows) {
    const lead = norm(raw);
    if (!lead.name || (!lead.phone && !lead.email)) {
      skip++;
      console.log(`  skip incomplete: ${JSON.stringify(lead)}`);
      continue;
    }
    // Prefer local WSL estate (real source of truth)
    const body = JSON.stringify({
      name: lead.name,
      phone: lead.phone || null,
      email: lead.email || null,
      property_id: lead.property_id,
      notes: lead.notes,
    });
    // Insert via python into estate.db for reliability even if tunnel flaky
    const py = `
import sqlite3, json
lead = json.loads(${JSON.stringify(body)})
con = sqlite3.connect("/home/xx/projects/sahiix-estate/estate.db")
cur = con.cursor()
cur.execute(
  "INSERT INTO leads (name, phone, email, property_id, notes) VALUES (?,?,?,?,?)",
  (lead.get("name"), lead.get("phone"), lead.get("email"), lead.get("property_id"), lead.get("notes"))
)
con.commit()
print(cur.lastrowid)
`;
    const r = spawnSync("wsl", ["-d", "Ubuntu-24.04", "--", "python3", "-c", py], { encoding: "utf8" });
    if (r.status !== 0) {
      console.log(`  FAIL ${lead.name}: ${r.stderr || r.stdout}`);
      continue;
    }
    ok++;
    console.log(`  + lead id=${r.stdout.trim()} ${lead.name} ${lead.phone || lead.email}`);
  }
  console.log(`[import-leads] ok=${ok} skip=${skip} estateUrl=${estateUrl}`);
  return { ok, skip };
}

function isPlaceholderPhone(phone) {
  const p = String(phone || "").replace(/\s+/g, "");
  // obvious templates
  return /1234567|000000|55501|9876543|4567890|2345678/.test(p) || p.length < 8;
}

async function importPalmOwners(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`palm file not found: ${abs}`);
  const data = JSON.parse(readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
  const owners = data.owners || data || [];
  if (!Array.isArray(owners)) throw new Error("expected { owners: [] } or array");
  console.log(`\n[import-palm] ${owners.length} owners from ${abs}`);
  let realish = 0;
  let template = 0;
  let upserted = 0;
  for (const o of owners) {
    const name = o.owner_name || o.name || "Unknown owner";
    const phone = o.phone || "";
    const addr = o.property_address || o.address || "";
    const price = Number(o.estimated_value_2026_aed || o.purchase_price_aed || 0);
    const score = Number(o.distress_score || scoreFromPrice(price));
    const placeholder = isPlaceholderPhone(phone);
    if (placeholder) {
      template++;
      console.log(`  TEMPLATE (not imported as real): ${name} | ${phone} | ${addr}`);
      continue;
    }
    realish++;
    const dealId = `PALM-${String(name).slice(0, 20).replace(/\W+/g, "-")}-${String(addr).slice(-12).replace(/\W+/g, "")}`.slice(0, 48);
    await sql`
      INSERT INTO deals (deal_id, property, type, area, price_aed, score, tier, commission, status, created_at)
      VALUES (
        ${dealId},
        ${addr || name},
        ${"palm-owner"},
        ${"Palm Jumeirah"},
        ${price},
        ${score},
        ${tierFromScore(score)},
        ${Math.round(price * 0.02)},
        ${"active"},
        NOW()
      )
      ON CONFLICT (deal_id) DO UPDATE SET
        property = EXCLUDED.property,
        price_aed = EXCLUDED.price_aed,
        score = EXCLUDED.score,
        tier = EXCLUDED.tier
    `;
    // contact
    await sql`
      INSERT INTO contacts (name, phone, email, units, total_value, rfm_score, tier, area, created_at)
      VALUES (
        ${name},
        ${phone || null},
        ${o.email || null},
        ${1},
        ${price},
        ${score},
        ${"Loyal"},
        ${"Palm Jumeirah"},
        NOW()
      )
    `;
    upserted++;
    console.log(`  + REAL ${dealId} | ${name} | ${phone}`);
  }
  console.log(`[import-palm] realish=${realish} template_skipped=${template} upserted=${upserted}`);
  if (template && !realish) {
    console.log("[import-palm] NOTE: file looks like a template (placeholder phones). Not treating as market-real.");
  }
  return { realish, template, upserted };
}

async function summary() {
  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM deals) AS deals,
      (SELECT COUNT(*) FROM deals WHERE deal_id LIKE 'PROP-estate-%') AS estate_inventory,
      (SELECT COUNT(*) FROM deals WHERE deal_id LIKE 'DXB-%') AS seed_deals,
      (SELECT COUNT(*) FROM deals WHERE deal_id LIKE 'RW-%') AS synthetic_deals,
      (SELECT COUNT(*) FROM campaigns) AS campaigns,
      (SELECT COUNT(*) FROM videos) AS videos,
      (SELECT COUNT(*) FROM signal_alerts) AS signals,
      (SELECT COUNT(*) FROM contacts) AS contacts
  `;
  console.log("\n[summary]", counts[0]);
  const estate = readEstateDb();
  console.log("[estate.db]", { properties: estate.properties.length, leads: estate.leads.length });
  return counts[0];
}

async function main() {
  const runAll = has("--all") || args.length === 0;
  try {
    if (runAll || has("--purge-synthetic")) await purgeSynthetic();
    if (runAll || has("--import-estate")) await importEstateInventory();
    const leadsPath = argVal("--import-leads");
    if (leadsPath) await importLeadsCsv(leadsPath);
    const palmPath = argVal("--import-palm") || (runAll ? resolve(process.env.USERPROFILE || "C:/Users/sahii", "palm_owners_high_priority.json") : null);
    if (palmPath && existsSync(palmPath)) await importPalmOwners(palmPath);
    else if (runAll) console.log("\n[import-palm] no palm file found at default path — skipped");
    await summary();
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
