# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- <args>   # Run CLI via tsx (no build step, for development)
npm run build           # Compile to dist/ via tsup (ESM, adds shebang)
npm start               # Run compiled dist/index.js directly
```

Tests exist for the contact finder's pure functions — run them with `npm test` (vitest). Type-check with `npx tsc --noEmit`.

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
- `SERPER_API_KEY` — Serper.dev API key for contact discovery (`src/lib/contactFinder.ts`). Free tier is 2,500 queries at serper.dev. If unset, `jobreach add` prompts for it interactively once and persists it to `.env`. Entering nothing skips contact discovery for that run; the rest of the pipeline is unaffected.

### Personalization config

Two layers, both git-ignored, both with committed `.example` templates:
- `jobreach.config.json` — identity (`name`, `school`, `schoolShort`, `gradMonth`). Loaded by `src/lib/profile.ts` with `loadProfile()`. Missing or unparseable → warning + generic defaults; the tool still runs end-to-end.
- `context/*.md` — three per-task files, each scoped to specific generation calls (see Personalization context below).

Partial config is supported: if `school` is undefined, the contact finder drops its alumni query and heuristic; if `gradMonth` is undefined, the new-grad framing in connection notes drops.

## Architecture

CLI entrypoint `src/index.ts` registers three commands. Each command drives a multi-step async pipeline displayed via `ora` spinners and ends with an interactive copy menu where applicable.

### `jobreach add <url>` (`src/commands/add.ts`)

1. Dedup check against Supabase (silently skipped if Supabase isn't configured)
2. Scrape the job URL via Playwright headless Chrome (`src/lib/scraper.ts`)
3. Extract structured job fields — `extractJobDetails()` in `src/lib/generator.ts` (Haiku, no context file)
4. **In parallel:** generate cover letter via `generateCoverLetter()` (Sonnet) + find contacts via `findContactsForJob()` in `src/lib/contactFinder.ts` (deterministic SERP queries, no LLM)
5. **Batched (one call):** generate ≤280-char LinkedIn connection notes via `generateConnectionNotesBatch()`
6. Persist everything to Supabase (jobs → contacts, note inline on each contact row)
7. Print a formatted terminal summary
8. Interactive copy menu (`src/lib/copyMenu.ts`) — cover letter + each note

### `jobreach qa [url] [question] [--pick]` (`src/commands/qa.ts`)

Looks up a previously tracked job by URL (or interactively via `--pick` / when url is omitted), then calls `answerApplicationQuestion()` in `src/lib/generator.ts` to draft an answer (150–250 words, Sonnet). Ends with a copy menu.

### `jobreach list` (`src/commands/list.ts`)

Prints all tracked jobs, most recent first, with status color-coded.

### Generation vs. contact discovery

One Anthropic SDK, plus a deterministic non-LLM contact finder:

- **`src/lib/generator.ts`** — uses `@anthropic-ai/sdk` (raw API) via `src/lib/anthropic.ts`. Single-turn `messages.create` calls, no tools, no streaming, ~200ms cold. Four exported functions (`extractJobDetails`, `generateCoverLetter`, `generateConnectionNotesBatch`, `answerApplicationQuestion`), each with its own scoped system prompt. `MODEL_FAST` (Haiku) is used for extraction; `MODEL_WRITER` (Sonnet) for everything else.
- **`src/lib/contactFinder.ts`** — no LLM, no scraping, no MCP, no Python. Given a job's company, it fires Google X-ray queries through the Serper.dev API (`site:linkedin.com/in "recruiter" "<company>"` etc.), parses the public search-result titles/snippets into name/title/company/profile-URL, classifies with deterministic regex heuristics, and ranks diversity-first with priority `university_recruiter > alumni > recruiter > engineer`, returning up to 3 contacts. Query strategy: 3 parallel queries (recruiter / university-early-career / school-alumni when `school` is configured), plus one "software engineer" backfill query only when fewer than 3 candidates survive filtering. Precision guards: candidates without a parseable title are dropped (no placeholders), and a company fuzzy-match plus "former/ex-" filtering drops ex-employees. The pure functions (`parseResult`, `classifyTitle`, `isCurrentEmployee`, `rankCandidates`) are unit-tested — run `npm test`.

**Why SERP instead of scraping:** the old path authenticated against LinkedIn and scraped it, a ToS violation with account-ban risk and a Python/uv/MCP subprocess dependency. The contact finder replaces that with public search-index queries — zero LinkedIn contact, deterministic, testable, ~3 Serper queries per job.

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
