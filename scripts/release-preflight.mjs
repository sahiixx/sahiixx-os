// Reads only the current process environment; never loads or prints credentials.
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
check("production mode", process.env.APP_ENV === "production");
check("unique authentication secret >=32 characters", (process.env.AUTH_SECRET?.length ?? 0) >= 32 && !/dev-secret|synthetic|fixture|change-me/i.test(process.env.AUTH_SECRET ?? ""));
let db; try { db = new URL(process.env.DATABASE_URL); } catch {}
check("Postgres database configured", db && ["postgres:", "postgresql:"].includes(db.protocol));
check("database TLS required", db && ["require", "verify-full"].includes(db.searchParams.get("sslmode")));
let estate; try { estate = new URL(process.env.ESTATE_API_URL); } catch {}
check("stable HTTPS estate endpoint", estate?.protocol === "https:" && !/(localhost|127\.0\.0\.1|trycloudflare\.com)$/.test(estate.hostname));
check("estate service authentication configured", process.env.ESTATE_API_KEY);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log("Manual gates: provisioned DB admin login, migrations on staging, backup restore, live estate freshness, edge rate limits, staging smoke and rollback.");
if (checks.some(item => !item.ok)) process.exitCode = 1;
