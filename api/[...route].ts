import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "./boot";

// Vercel Node Function adapter. Cloudflare Pages uses the separate Worker bundle.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0] ?? "https";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  let body: BodyInit | undefined;
  if (!/[\/](GET|HEAD)$/i.test(req.method ?? "GET") && req.body !== undefined) {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const response = await app.fetch(new Request(url, { method: req.method, headers, body }));
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}
