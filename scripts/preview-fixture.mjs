// Loopback-only synthetic fixture preview. No database, real estate data, or production credentials.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import app from "../dist/boot.js";
const estate = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(req.url === "/health"
    ? { status: "ok", recovery: true, read_only: true, snapshot: "synthetic-fixture", freshness_verified: false }
    : [{ id: 42, name: "Synthetic recovery fixture" }]));
}).listen(3013, "127.0.0.1");
const bindings = { APP_ENV: "development", AUTH_SECRET: "synthetic-local-browser-test-secret-12345",
  ADMIN_EMAIL: "fixture@example.invalid", ADMIN_PASSWORD: "synthetic-browser-only", ESTATE_API_URL: "http://127.0.0.1:3013" };
const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:8792");
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await app.fetch(new Request(url, { method: req.method, headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), bindings);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const root = resolve("dist/public");
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + "/") && !file.startsWith(root + "\\")) {
      if (file !== root) { res.writeHead(403).end(); return; }
    }
    let body; let contentType = types[extname(file)];
    try { if (!contentType) throw new Error(); body = await readFile(file); }
    catch { body = await readFile(resolve(root, "index.html")); contentType = "text/html"; }
    res.writeHead(200, { "Content-Type": contentType }); res.end(body);
  } catch { res.writeHead(500).end("Fixture preview failed"); }
}).listen(8792, "127.0.0.1");
function stop() { server.close(); estate.close(); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
