// Password hashing via Web Crypto PBKDF2-SHA256. No native deps — works in
// Node (>=20, globalThis.crypto) and Cloudflare Workers (crypto.subtle).
// Stored format: pbkdf2$<iterations>$<saltB64>$<hashB64>

const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ALGO = "PBKDF2";

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(plain), ALGO, false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits(
    { name: ALGO, salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    HASH_BYTES * 8
  );
  return `pbkdf2$${ITERATIONS}$${b64(salt.buffer)}$${b64(hash)}`;
}

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  try {
    const iterations = Number(parts[1]);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
    const salt = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
    const expected = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));
    if (salt.length !== SALT_BYTES || expected.length !== HASH_BYTES || plain.length > 1024) return false;
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(plain), ALGO, false, ["deriveBits"]);
    const hash = new Uint8Array(await crypto.subtle.deriveBits(
      { name: ALGO, salt, iterations, hash: "SHA-256" }, keyMaterial, HASH_BYTES * 8,
    ));
    let difference = 0;
    for (let i = 0; i < HASH_BYTES; i++) difference |= hash[i] ^ expected[i];
    return difference === 0;
  } catch { return false; }
}
