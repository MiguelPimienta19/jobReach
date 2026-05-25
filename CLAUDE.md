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
jobreach add <url>
jobreach qa [url] [question] [--pick]
jobreach list
```

## Environment

Requires a `.env` file at the project root (see `.env.example`):
- `ANTHROPIC_API_KEY` — drives the generation layer (cover letter, notes, qa, extract) via the raw Anthropic SDK
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SECRET_KEY` — Supabase secret key (`sb_secret_...`). Replaces the legacy `service_role` key. Used because jobreach is a user-controlled local CLI with full read/write needs and no RLS — that's a "trusted backend" context, not a public client.

The LinkedIn discovery agent (`src/agents/linkedinAgent.ts`) uses `@anthropic-ai/claude-agent-sdk`, which runs on the user's Claude Code subscription — separate from `ANTHROPIC_API_KEY`.

The agent shells out to the **`linkedin-scraper-mcp`** MCP server as a subprocess (`uv tool run linkedin-scraper-mcp`). `uv` must be installed and the tool available, or LinkedIn discovery will fail.

### Personalization config

Two layers, both git-ignored, both with committed `.example` templates:
- `jobreach.config.json` — identity (`name`, `school`, `schoolShort`, `gradMonth`). Loaded by `src/lib/profile.ts` with `loadProfile()`. Missing or unparseable → warning + generic defaults; the tool still runs end-to-end.
- `context/*.md` — three per-task files, each scoped to specific generation calls (see Personalization context below).

Partial config is supported: if `school` is undefined, the LinkedIn agent system prompt drops the alumni heuristic; if `gradMonth` is undefined, the new-grad framing in connection notes drops.

## Architecture

CLI entrypoint `src/index.ts` registers three commands. Each command drives a multi-step async pipeline displayed via `ora` spinners and ends with an interactive copy menu where applicable.

### `jobreach add <url>` (`src/commands/add.ts`)

1. Dedup check against Supabase (silently skipped if Supabase isn't configured)
2. Scrape the job URL via Playwright headless Chrome (`src/lib/scraper.ts`)
3. Extract structured job fields — `extractJobDetails()` in `src/lib/generator.ts` (Haiku, no context file)
4. **In parallel:** generate cover letter via `generateCoverLetter()` (Sonnet) + find contacts via `findContactsForJob()` in `src/agents/linkedinAgent.ts` (multi-turn Haiku agent)
5. **Batched (one call):** generate ≤280-char LinkedIn connection notes via `generateConnectionNotesBatch()`
6. Persist everything to Supabase (jobs → contacts, note inline on each contact row)
7. Print a formatted terminal summary
8. Interactive copy menu (`src/lib/copyMenu.ts`) — cover letter + each note

### `jobreach qa [url] [question] [--pick]` (`src/commands/qa.ts`)

Looks up a previously tracked job by URL (or interactively via `--pick` / when url is omitted), then calls `answerApplicationQuestion()` in `src/lib/generator.ts` to draft an answer (150–250 words, Sonnet). Ends with a copy menu.

### `jobreach list` (`src/commands/list.ts`)

Prints all tracked jobs, most recent first, with status color-coded.

### Two SDKs, two jobs

The repo deliberately mixes two Anthropic SDKs:

- **`src/lib/generator.ts`** — uses `@anthropic-ai/sdk` (raw API) via `src/lib/anthropic.ts`. Single-turn `messages.create` calls, no tools, no streaming, ~200ms cold. Four exported functions (`extractJobDetails`, `generateCoverLetter`, `generateConnectionNotesBatch`, `answerApplicationQuestion`), each with its own scoped system prompt. `MODEL_FAST` (Haiku) is used for extraction; `MODEL_WRITER` (Sonnet) for everything else.
- **`src/agents/linkedinAgent.ts`** — uses `@anthropic-ai/claude-agent-sdk` (`query()` loop). One real multi-turn agent (`maxTurns: 5`, Haiku 4.5) with an SDK MCP server wrapping the upstream `linkedin-scraper-mcp`. The wrapper proxies `get_company_employees` and `search_people` then slims each response down to `{name, title, linkedinUrl}` before returning to the agent. Tight system prompt with pre-loaded heuristics (recruiter/uni-recruiter/alumni/engineer regex categories) keeps the agent acting rather than figuring out title taxonomy.

The agent owns the upstream MCP client; `closeLinkedinAgent()` is called from `add.ts` after the pipeline so the CLI exits cleanly.

### Personalization context (`context/`)

The `context/` directory holds personal background that the generation layer reads at runtime. Each file is loaded independently and scoped to specific calls:

| File | Loaded by | Notes |
|---|---|---|
| `context/me.md` | cover letter, qa | Canonical voice anchor — bio, voice rules, projects, resume material |
| `context/cover-letter.md` | cover letter only | Format rules + one verbatim sample for tone calibration |
| `context/connection-note.md` | connection notes only | Self-contained — does NOT load `me.md`; voice distilled for ≤280-char outreach + verbatim samples |

`extractJobDetails` uses no context file — just a tiny inline JSON-schema prompt. `.example.md` siblings ship in the repo as templates; the real files are git-ignored.

Missing any single file is fine — that call degrades silently. Missing all three triggers a one-line warning at module load.

### Code style

All source files follow a strict structural blueprint applied in May 2026:
- Function signatures on a single line
- Explicit `{}` braces on every `if`/`for`/`while`/`try`/`catch`/`finally`, body on its own line
- Multi-line return objects for 3+ keys with trailing commas
- Section banner comments (`// === ... ===`) to group logical layers
- Local interfaces declared at the top of each file (no inline casts in loops/maps)
- Vertical whitespace between logical steps inside functions

Do not collapse `if` blocks onto one line. Do not skip braces. Keep this style consistent.

### Database schema (`supabase/schema.sql`)

Two tables: `jobs` (one row per URL, unique on `url`) and `contacts` (many per job, FK to jobs, unique on `(job_id, name)`, with `connection_note` inline). `saveJob()` upserts on `url` conflict; `saveContact()` upserts on `(job_id, name)`.

The TypeScript field names use camelCase while Supabase columns use snake_case — mapping happens in `src/lib/supabase.ts`.

Run `supabase/schema.sql` in the Supabase SQL Editor to initialize the database. The file reflects the current canonical schema. The `supabase/migrations/` directory tracks incremental changes; the most recent (`20260524000000_drop_messages.sql`) drops the obsolete `messages` table and moves any saved content onto `contacts.connection_note`.

### Module system

Pure ESM (`"type": "module"` in package.json, `"module": "ESNext"` in tsconfig). All internal imports must use `.js` extensions even though they're `.ts` source files.
