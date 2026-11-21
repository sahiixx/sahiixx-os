# Dependency repair and validation

Prepared on branch `codex/estate-repair-20261106` in a separate worktree after
the original checkout's uncommitted changes disappeared during validation.
The pending Jarvis tools edit in the original checkout was left untouched.

## Changes

- Restored the retry-safe NEXUS import and its synthetic regression tests.
- Restored the public tunnel-health fixes and offline regression checks.
- Added Node 22 types and a pnpm 9 lockfile.
- Removed OpenTelemetry packages that had no runtime imports/initialization.
  Existing app counters and Prometheus rendering are independent of them.
- Upgraded Recharts from its retired 2.x line to 3.10.1. Added render checks
  for the actual Goldmine and Signals pages with synthetic data and fixed
  viewport measurements.
- Pinned jest-dom to the recommended 6.9.1 release within its existing major.
- Corrected the Pages bundle to select postgres.js's workerd export and keep
  cloudflare:sockets external; the Node bundle keeps the Node adapter.

## Scoped Drizzle metadata correction

drizzle-kit 0.30.6 declares the deprecated @esbuild-kit/esm-loader dependency,
but its published executable JavaScript does not import it. Its runtime loader
is bundled. `.pnpmfile.cjs` removes that dependency only for this exact
inspected version, eliminating that unused loader and its legacy utilities.
This is a package manifest correction during resolution, not warning filtering.
Re-inspect the published code when changing the Drizzle Kit version.

Before/after offline exports of the actual db/schema.ts produced identical
SQL. `pnpm check:schema` and the CI step repeat the connection-free export;
they do not push a schema, execute a migration or seed a database.

## Commands

Use the declared pnpm 9.0.0 and Node 22:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:nexus
pnpm test:charts
pnpm check:schema
bash scripts/tests/estate-health.test.sh
pnpm build
```

The UI tests cover DOM/SVG rendering, not pixel-level browser appearance.
No production routing, DNS, deployment or customer record was changed.

## Packaged recovery integration

The built Pages Worker was exercised locally through Wrangler against the
read-only recovered estate API, with no production database/Hyperdrive/AI
bindings. Health and NEXUS shell checks pass. A local fixture account signs
in successfully; anonymous import returns 401, and an authenticated recovery
import is rejected before any CRM database access. Source and recovered
database hashes remain unchanged.

NEXUS now labels recovery snapshots and disables import in the UI. The API
independently rejects recovery sources and fails closed if source health is
unavailable. Six API tests and four actual page-render checks pass. Full type
checking and production build pass after these additions.

Preview launch, safe smoke check and receipt are under
`C:/Users/sahii/work-audits/lead-system/preview/`. Local preview URL:
http://127.0.0.1:8790. No claim of production database readiness is made.
The initial concurrent validation hit machine-wide memory exhaustion; preview
processes were stopped and final checks passed sequentially with reduced
per-process memory/concurrency. Other user processes were not terminated.

References:
- https://github.com/recharts/recharts/wiki/3.0-migration-guide
- https://pnpm.io/pnpmfile
