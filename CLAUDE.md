# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- <args>   # Run CLI via tsx (no build step, for development)
npm run build           # Compile to dist/ via tsup (ESM, adds shebang)
npm start               # Run compiled dist/index.js directly
```

There are no tests. Type-check with `npx tsc --noEmit`.

To install globally for local testing after build:
```bash
npm install -g .
jobreach add <url> [--connect]
jobreach qa [url] [question] [--pick]
jobreach list
jobreach connect [--yes] [--regen]
```

## Environment

Requires a `.env` file at the project root (see `.env.example`):
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon/public key

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) uses the user's Claude Code subscription — no separate Anthropic API key is needed.

The `connect` command and `add --connect` both shell out to the **`linkedin-scraper-mcp`** MCP server, launched as `uv tool run linkedin-scraper-mcp`. `uv` must be installed and the tool available, or LinkedIn actions will fail. The same MCP server is also used by `findPeopleAtCompany` for contact discovery.

## Architecture

CLI entrypoint `src/index.ts` registers four commands. Each command drives a multi-step async pipeline displayed via `ora` spinners.

### `jobreach add <url> [--connect]` (`src/commands/add.ts`)

1. Dedup check against Supabase (silently skipped if Supabase isn't configured)
2. Scrape the job URL via Playwright headless Chrome (`src/lib/scraper.ts`)
3. Extract structured job fields — `extractJobDetails()` in `src/lib/generator.ts`
4. **In parallel:** generate cover letter + find contacts via LinkedIn MCP (`findPeopleAtCompany()` in `src/lib/agent.ts`)
5. **In parallel per contact:** generate LinkedIn outreach message + 280-char connection note (`generateOutreachMessage()`, `generateConnectionNote()` in `src/lib/generator.ts`)
6. Persist everything to Supabase (jobs → contacts → messages)
7. Print a formatted terminal summary
8. If `--connect` is passed: send LinkedIn connection requests for every contact with a `linkedinUrl` via `sendConnections()` in `src/lib/linkedin.ts`

### `jobreach qa [url] [question] [--pick]` (`src/commands/qa.ts`)

Looks up a previously tracked job by URL (or interactively via `--pick` / when url is omitted), then calls `answerApplicationQuestion()` in `src/lib/generator.ts` to draft an answer (150–250 words).

### `jobreach list` (`src/commands/list.ts`)

Prints all tracked jobs, most recent first, with status color-coded.

### `jobreach connect [--yes] [--regen]` (`src/commands/connect.ts`)

Sends LinkedIn connection requests for a previously tracked job. Interactive job picker via `@inquirer/prompts`. Flags:
- `--regen` regenerates connection notes via `generateConnectionNote()` and saves them back to Supabase
- `--yes` skips per-contact confirmation and sends all
- Default flow: prompts per contact before sending; updates `messages.status` to `sent` after success

### `src/lib/agent.ts` vs `src/lib/generator.ts`

Both use `query()` from `@anthropic-ai/claude-agent-sdk`, but differently:

- **`agent.ts`** — multi-turn agentic loop (`maxTurns: 10`) with the `linkedin-scraper-mcp` MCP server attached. Uses `get_company_employees` and `search_people` to find recruiters and university recruiters (max 3). Streams messages from the loop and parses the final JSON array of contacts from the terminal `result` message. Runs with `allowDangerouslySkipPermissions: true` and `permissionMode: 'bypassPermissions'`.
- **`generator.ts`** — single-turn (`maxTurns: 1`), no tools (`allowedTools: []`, `permissionMode: 'dontAsk'`), just text generation. All generation functions share a `MY_BACKGROUND` system prompt that reads from `context/me.md` at module load (with a hardcoded fallback bio if the file is missing).
- **`linkedin.ts`** — uses `query()` to drive the LinkedIn MCP's `connect_with_person` tool, sending a connection request with a specific note. Runs per-contact with progress streamed through `ora` spinners.

### Personalization context (`context/`)

The `context/` directory holds personal background that the generator reads at runtime:
- `me.md` — bio injected into the system prompt for all `generator.ts` calls (cover letter, outreach, connection note, qa). **This is the canonical place to edit personality/background** — don't edit the fallback string in `generator.ts`.
- `resume.md`, `targets.md`, `writing-samples.md` — not currently loaded by code but kept as reference material.

### Database schema (`supabase/schema.sql`)

Three tables: `jobs` (one row per URL, unique on `url`), `contacts` (many per job, FK to jobs, unique on `(job_id, name)`), `messages` (many per contact+job, FKs to both, status: `draft | sent | replied`). `saveJob()` upserts on `url` conflict; `saveContact()` upserts on `(job_id, name)`.

The TypeScript field names use camelCase while Supabase columns use snake_case — the mapping happens in `src/lib/supabase.ts`.

**Heads-up:** `supabase/schema.sql` is out of sync with what the code expects:
- Missing `connection_note TEXT` column on `contacts` (referenced by `saveContact`, `getContactsForJob`, `updateConnectionNote`)
- Missing comma after the `UNIQUE (job_id, name)` constraint (would prevent a fresh `CREATE TABLE` from running)

If you re-run the schema on a fresh database, fix these first.

### Module system

Pure ESM (`"type": "module"` in package.json, `"module": "ESNext"` in tsconfig). All internal imports must use `.js` extensions even though they're `.ts` source files.
