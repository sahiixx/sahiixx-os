# sahiix-knowledge-mcp

A stdio **MCP server** that exposes the SAHIIX **Documents archive** (Neon Postgres
full-text search) and the **RERA / NEXUS playbook** files as tools / resources /
prompts, so Claude Code (and Jarvis via a future tool) can browse real-estate
knowledge.

It mirrors the [`gentleman-book-mcp`](https://github.com/Alan-TheGentleman/gentleman-book-mcp)
pattern (book-as-MCP) but is implemented in **TypeScript** and reuses the
existing sahiixx-os lib directly — `getDb()`, `chatComplete`/`extractJson`,
`applyRules`, the `documents`/`document_types`/`matching_rules` schema, and the
seeded `demoDocuments`/`demoDocTypes`/`demoRules` fallback store. There is **no
SQL or LLM logic duplicated** from `api/documents-router.ts`: the FTS query is
the same parameterized raw SQL, and the metadata extract is the same
`chatComplete({json:true})` + `extractJson` call.

## Surface

**9 tools**
| Tool | Args | Source |
|---|---|---|
| `list_playbooks` | — | disk |
| `read_playbook` | `slug` | disk |
| `search_playbooks` | `query` | disk (keyword) |
| `list_documents` | `type?` | Neon → demo |
| `search_documents` | `query, type?` | Neon FTS → demo substring |
| `get_document` | `id` | Neon → demo |
| `list_doc_types` | — | Neon → demo |
| `ask_rera` | `question` | RAG (playbooks + docs) → Ollama Cloud |
| `extract_metadata` | `ocr_text, source_name` | matching rules + LLM |

**Resources** (static, read at startup): `rera://playbooks` (index) + one per
playbook (`rera://playbooks/{slug}`) + `nexus://palm-owners`.

**Prompts**: `rera_qa` (gather-then-answer with citations), `summarize_playbook`.

## Env

Loads `sahiixx-os/.env` into `process.env` on startup, so `api/lib/env` getters
read the same vars the Hono app uses: `DATABASE_URL` (Neon), `OLLAMA_URL` /
`OLLAMA_API_KEY` / `JARVIS_OLLAMA_MODEL` / `JARVIS_PROVIDER` (the active Ollama
Cloud provider). Also:

- `RERA_PLAYBOOKS_DIR` (default `$HOME`) — where the playbook `.md` files +
  `palm_owners_high_priority.json` live.

## Run

```bash
# from the sahiixx-os repo root
npm run mcp:knowledge        # = tsx mcp/knowledge/src/index.ts  (stdio)
```

Smoke test (handshake + tools/list + a few tool calls):
```bash
node <path>/smoke-mcp.mjs     # see verification notes in the plan
```

## Wire into Claude Code

Project-scoped (auto-loaded, prompts for approval on first use) — `sahiixx-os/.mcp.json`:
```json
{
  "mcpServers": {
    "sahiix-knowledge": {
      "command": "npx",
      "args": ["tsx", "mcp/knowledge/src/index.ts"],
      "cwd": "C:\\Users\\sahii\\sahiixx-os"
    }
  }
}
```
`cwd` must be the repo root so `tsx` resolves the `@db/*` tsconfig path alias.
`RERA_PLAYBOOKS_DIR` defaults to `$HOME`, so the playbooks are found without
extra config on this box.

## Notes

- Read-only over the live data: it never writes to Neon or the playbook files.
- Demo fallback: every Neon read falls back to the seeded demo store on any DB
  error, so the server is useful with zero DB (matches the Documents module).
- English-only FTS (`to_tsvector('english', …)`) — inherited from the Documents
  module; Arabic search stemming is a phase-2 gap.