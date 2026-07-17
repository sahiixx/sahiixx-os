# Real data ops (not seed theatre)

## Commands
```bash
npm run data:real              # purge synthetic + import estate inventory + scan palm file
npm run data:purge-synthetic   # remove operator/RW test rows only
npm run data:import-estate     # PROP-estate-* from live WSL estate.db
node scripts/real-data-ops.mjs --import-leads path/to/leads.csv
node scripts/real-data-ops.mjs --import-palm path/to/owners.json
```

## Leads CSV columns
`name,phone,email,notes,property_id` (see `import-leads.example.csv`)

Leads write into **live WSL estate.db** (source of truth), not Neon seed.

## Truth labels
| Prefix | Meaning |
|--------|---------|
| DXB-* | Seed demo deals (kept for UI until replaced) |
| PROP-estate-* | Live inventory from estate.db properties |
| PALM-* | Imported from Palm owners file (only non-placeholder phones) |
| RW-* / OPERATOR | Synthetic tests — purged by data:purge-synthetic |
