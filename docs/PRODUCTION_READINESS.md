# Production release candidate — 2026-11-06

Deployment target: Cloudflare Pages Worker with Neon Postgres. Local changes are on
`codex/estate-repair-20261106`. No production deployment, migration, secret, DNS,
customer record or original checkout was changed.

## Implemented

- Vite 8.3.6 / React plugin 6.2.1 / TypeScript 7.0.2 / esbuild 0.28.2, React 19,
  reproducible pnpm 9 lockfile. Minimum Node 22.12. The Tailwind 3 theme and
  inspected Drizzle Kit version remain intentionally pinned to their tested lines.
- Authenticated CRM, documents, bridge and operational reads and lead writes.
  Production never authenticates the environment administrator. A DB failure
  returns service unavailable rather than demo records or apparent write success.
- Production authentication requires a unique secret >=32 characters. JWTs require
  issuer, audience, expiry, issued-at and a recognized role. Existing JWTs must
  sign in again. New password hashes use PBKDF2-SHA256 600,000 iterations; old
  100,000-iteration hashes remain verifiable. Malformed hashes have bounded cost.
- Request-scoped Worker bindings through AsyncLocalStorage; missing bindings
  cannot inherit another request's secrets. Neon clients are keyed to the URL.
- Jarvis device capabilities require explicit admin settings. Natural-language
  messages cannot enable shell or OS access; approvals require admin role.
- Production debug routes disabled; metrics admin-only; same-origin CORS,
  2 MiB request limit, no-store API responses, CSP, request IDs and HTTPS HSTS.
  Public readiness errors and production tRPC stacks are redacted.
- Browser bearer credentials moved from persistent localStorage to tab-scoped
  sessionStorage; earlier persisted credentials are cleared. JavaScript can still
  access the active bearer token. CSP reduces exposure; HttpOnly sessions and
  server-side revocation remain future security improvements.
- CI no longer prints/stores sign-in tokens or uses fallback credentials. Read-only
  GitHub permissions, timeouts, frozen installs, security/API/UI/browser tests.
- Seeding requires development mode and explicit destructive fixture acknowledgement.
- Recovery snapshots cannot become live deals; retry-safe imports preserve existing
  deals. Synthetic host telemetry is unavailable in production. Terminal commands
  no longer invent test or repair results.

## Reproduce

Use Node >=22.12 and pnpm 9.0.0. Run `pnpm install --frozen-lockfile`, `pnpm run check`,
`pnpm run test:security`, `pnpm run test:nexus`, `pnpm run test:charts`,
`pnpm run check:schema`, `pnpm run build`. Install Chromium with
`pnpm exec playwright install chromium`; run `pnpm run test:e2e`.
The browser server uses synthetic data, loopback ports 8792/3013, and no database.
Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only to select an existing local browser.

## Staging workflow

`.github/workflows/staging-verify.yml` is manual and targets only the protected
GitHub `staging` environment. Before using it, create that GitHub environment,
require reviewer approval, and set `STAGING_DATABASE_URL` to a TLS connection for
a Neon branch populated only with synthetic fixtures. Never point this variable at
`main`, `production`, or the production-derived `sahiix-nexus-dev` branch. The
workflow rejects obvious production-looking host/user/path names, installs the
locked dependency graph, exports the schema, applies repository migrations to the
staging URL, then typechecks. It does not deploy Pages or touch the production
branch. After migrations, run the local synthetic API/browser tests and an operator
approved staging smoke test; migration completion does not prove app connectivity.

The current Neon integration contains no confirmed clean synthetic branch. The
`sahiix-nexus-dev` branch is parent-data derived, so this workflow must not run
against it. A maintainer must provision and populate an isolated synthetic branch
and configure the protected environment before dispatching it.

## Release gates — not yet verified

1. Run `pnpm run release:preflight` in a secured release environment. It reads only
   process environment and reports booleans, never credentials. This is configuration
   validation, not proof of connectivity or data freshness.
2. Provision and verify a DB-backed administrator on staging through an approved
   operator workflow before release. Environment bootstrap is disabled in production.
   Rotate any previous known development credentials and weak signing secrets.
3. Review migrations; apply to staging, exercise real CRUD and permissions, restore a
   backup, and record rollback. No production schema operation has been performed.
4. Repair the named estate tunnel and authenticated stable HTTPS origin. Verify
   current live data. The June 29 read-only recovery snapshot is not a live source.
5. Configure edge login/AI rate limits: application counters are best-effort per
   isolate/cache, not a distributed abuse boundary. Verify provider cost limits.
6. Check CSP compatibility for document OCR/PDF/voice integrations using staging
   fixtures. External browser connections are intentionally blocked unless explicitly
   reviewed and allowed. Review roles for single-organization deployment; this is
   not a multi-tenant isolation implementation.
7. Deploy a staging artifact, run production-mode sign-in and real-database E2E,
   verify health/readiness and rollback, then approve the production release.

The Node bundle is also emitted for development tooling; Cloudflare Pages is the
validated production runtime. Local checks do not certify load capacity, provider
availability, compliance, or an already deployed release.

Migration references: https://vite.dev/guide/migration and
https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/.
