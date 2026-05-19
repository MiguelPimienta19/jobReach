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
jobreach qa <url> "<question>"
```

## Environment

Requires a `.env` file at the project root (see `.env.example`):
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon/public key

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) uses the user's Claude Code subscription — no separate Anthropic API key is needed.

## Architecture

The CLI has two commands (`add`, `qa`) that each drive a multi-step async pipeline displayed via `ora` spinners.

**`jobreach add <url>`** pipeline (in `src/commands/add.ts`):
1. Dedup check against Supabase
2. Scrape the job URL via Playwright headless Chrome (`src/lib/scraper.ts`)
3. Extract structured job fields (company, title, description, etc.) — `extractJobDetails()` in `src/lib/generator.ts`
4. Generate a cover letter — `generateCoverLetter()` in `src/lib/generator.ts`
5. Find contacts at the company using an agentic loop — `findPeopleAtCompany()` in `src/lib/agent.ts`
6. Generate per-contact LinkedIn outreach messages — `generateOutreachMessage()` in `src/lib/generator.ts`
7. Persist everything to Supabase (jobs → contacts → messages)
8. Print a formatted terminal summary

**`jobreach qa <url> "<question>"`** (in `src/commands/qa.ts`): looks up a previously tracked job by URL, then calls `answerApplicationQuestion()` in `src/lib/generator.ts` to draft an answer.

### Key distinctions between `lib/agent.ts` and `lib/generator.ts`

Both use `query()` from `@anthropic-ai/claude-agent-sdk`, but differently:

- **`agent.ts`** — runs a multi-turn agentic loop (`maxTurns: 15`) with `WebSearch` enabled. Streams messages from the loop and parses the final JSON array of contacts from the terminal `result` message.
- **`generator.ts`** — single-turn (`maxTurns: 1`), no tools, just text generation. All generation functions share a `MY_BACKGROUND` system prompt constant containing Miguel's bio/projects, which drives the personalization of all generated content.

### Database schema (`supabase/schema.sql`)

Three tables: `jobs` (one row per URL, unique on `url`), `contacts` (many per job, FK to jobs), `messages` (many per contact+job, FK to both). The `saveJob()` function uses upsert on `url` conflict. The TypeScript field names use camelCase while Supabase columns use snake_case — the mapping happens in `src/lib/supabase.ts`.

### Module system

Pure ESM (`"type": "module"` in package.json, `"module": "ESNext"` in tsconfig). All internal imports must use `.js` extensions even though they're `.ts` source files.
