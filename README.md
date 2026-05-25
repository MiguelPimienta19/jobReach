# jobreach

A CLI tool that turns a job posting URL into a cover letter, ranked LinkedIn contacts, personalized connection notes, and a tracked-application database — in under a minute, with an interactive copy menu at the end.

## How it works

```
jobreach add <url>
```

1. **Scrape** — Playwright fetches the job posting (handles JS-rendered pages)
2. **Parse** — Claude Haiku extracts title, company, description, requirements, location
3. **Cover letter** — Claude Sonnet writes a targeted cover letter in your voice
4. **LinkedIn discovery agent** — A multi-turn Claude Haiku agent uses the LinkedIn MCP server to list employees and (if needed) broaden via search, then ranks up to 3 contacts (recruiter, alum, engineer). Runs in parallel with the cover letter.
5. **Connection notes** — One batched Claude Sonnet call writes a ≤280-char LinkedIn connection request note for every contact
6. **Persist** — Everything saved to Supabase (deduplicates by URL)
7. **Copy menu** — Arrow-key through cover letter and each note to copy to clipboard

```
jobreach list
```

Shows all tracked applications, most recent first, with status.

```
jobreach qa [url] [question]
```

Looks up an already-tracked job and answers an application question in your voice. Run without arguments (or with `--pick`) to interactively select from your tracked jobs. Ends with a copy menu.

---

## Prerequisites

- **Node.js 18+**
- **[uv](https://docs.astral.sh/uv/)** — Python package manager (for the LinkedIn MCP server)
- **Supabase account** — [supabase.com](https://supabase.com), free tier is fine
- **Anthropic API key** — for the generation layer (cover letter, notes, qa, extract) via the raw Anthropic SDK
- **Claude Code subscription** — the LinkedIn discovery agent uses the Agent SDK, which runs on your Claude Code subscription separately from the API key above

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/jobReach.git
cd jobReach
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
ANTHROPIC_API_KEY=sk-ant-your_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key_here
```

### 3. Personalize the output

There are two layers of personalization, both git-ignored. The repo ships `.example` templates for each.

**Layer 1 — identity (small, structured):**

```bash
cp jobreach.config.example.json jobreach.config.json
```

Open `jobreach.config.json` and fill in your first name, school (if you're a student), and grad month. If you're not a student, remove the `school` and `gradMonth` lines — the LinkedIn discovery agent disables its alumni heuristic and leans on recruiter / university-recruiter / engineer categories instead, and the new-grad framing drops out of connection notes.

**Layer 2 — voice and background (long-form):**

```bash
cp context/me.example.md              context/me.md
cp context/cover-letter.example.md    context/cover-letter.md
cp context/connection-note.example.md context/connection-note.md
```

Each file is scoped to specific generation calls — see the table below. Edit in place; files are read at runtime, no rebuild needed.

| File | Used by | What goes in it |
|---|---|---|
| `context/me.md` | cover letter, qa | Bio, voice rules, projects, resume bullets |
| `context/cover-letter.md` | cover letter only | Format rules + one verbatim example for tone calibration |
| `context/connection-note.md` | connection notes only (self-contained) | 280-char rules, voice distilled for short outreach, verbatim sample notes |

Missing any single file is fine — that specific call degrades to no extra context. Missing all three triggers a one-line warning and a generic stub bio.

### 4. Initialize the database

In your Supabase dashboard, open the **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql). This creates two tables (`jobs`, `contacts`) with the right indexes and triggers.

If you're upgrading an older install that still has the `messages` table, also run [`supabase/migrations/20260524000000_drop_messages.sql`](supabase/migrations/20260524000000_drop_messages.sql) to migrate any saved notes onto `contacts.connection_note` and drop the obsolete table.

### 5. Install the LinkedIn MCP server

```bash
uv tool install linkedin-scraper-mcp
```

### 6. Log in to LinkedIn

```bash
uv tool run linkedin-scraper-mcp --login
```

This opens a browser for you to log in. Your session is saved locally and reused on subsequent runs. Without it, contact discovery will be skipped.

### 7. Build

```bash
npm run build
```

### 8. Link globally

```bash
npm link
```

Now `jobreach` is available anywhere in your terminal.

> **If you edit `context/*.md` or `jobreach.config.json` later**, you don't need to rebuild — they're read at runtime. Only rerun `npm run build` if you change TypeScript source.

---

## Usage

### Add a job posting

```bash
jobreach add "https://jobs.ashbyhq.com/company/role-id"
```

Output includes:
- Parsed job details (title, company, location, salary if listed)
- A ready-to-paste cover letter
- Up to 3 contacts found on LinkedIn (recruiter, alum, engineer), each with a ≤280-char connection note
- An interactive copy menu: arrow + enter to copy any of the above to clipboard

Running the same URL twice is a no-op — the tool checks Supabase before doing any work.

### List tracked jobs

```bash
jobreach list
```

### Answer an application question

```bash
jobreach qa --pick                                          # interactive job picker
jobreach qa "https://..." "What's a challenge you've overcome?"
```

The job must already exist in Supabase (added via `jobreach add`). The answer is written in first person using the stored job context and your personal background. Ends with a copy menu.

---

## Commands reference

| Command | Arguments | Description |
|---|---|---|
| `jobreach add` | `<url>` | Scrape a job, generate cover letter + connection notes, save to Supabase, interactive copy |
| `jobreach list` | — | Show all tracked applications, newest first |
| `jobreach qa` | `[url] [question] [--pick]` | Answer an application question for a tracked job |

---

## Database schema

Two tables in Supabase:

| Table | What it stores |
|---|---|
| `jobs` | Job postings — title, company, description, requirements, cover letter, status |
| `contacts` | Contacts found per job — name, title, LinkedIn URL, role type, connection note (inline) |

Job status can be: `pending` → `applied` → `interview` → `offer` / `rejected`. Currently managed manually in Supabase; no CLI command for status updates yet.

---

## Architecture overview

Two LLM layers, used for what each does best:

- **Generation layer** (raw Anthropic SDK): cover letter, connection notes, qa, extract. Single-turn, no tools, ~200ms cold call. Sonnet for writing; Haiku for structured extraction.
- **Discovery agent** (Agent SDK on Claude Code subscription): one real agent at `src/agents/linkedinAgent.ts`. Multi-turn (≤5), Haiku 4.5, with a slim MCP wrapper around `linkedin-scraper-mcp` that trims employee payloads down to `{name, title, linkedinUrl}` before they reach the model.

---

## Tech stack

| Piece | What it does |
|---|---|
| `commander` | CLI argument parsing |
| `playwright` | Headless browser scraping |
| `@anthropic-ai/sdk` | Raw Anthropic SDK — generation layer (cover letter, notes, qa, extract) |
| `@anthropic-ai/claude-agent-sdk` | Agent SDK — drives the LinkedIn discovery agent with MCP tools |
| `@modelcontextprotocol/sdk` | TypeScript MCP client used by the agent's slim payload wrapper |
| `linkedin-scraper-mcp` | LinkedIn scraper exposed as an MCP server (Python, run via `uv`) |
| `@supabase/supabase-js` | Persistence |
| `clipboardy` | Cross-platform clipboard for the copy menu |
| `@inquirer/prompts` | Interactive pickers (qa picker, copy menu) |
| `ora` + `chalk` | Terminal output |
| `tsup` | Build (ESM output) |
