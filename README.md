# jobreach

A CLI tool that turns a job posting URL into a cover letter, personalized LinkedIn connection notes, and a database of every application — in under a minute.

## How it works

```
jobreach add <url>
```

1. **Scrape** — Playwright fetches the job posting (handles JS-rendered pages)
2. **Parse** — Claude extracts title, company, description, requirements, location
3. **Cover letter** — Claude writes a targeted cover letter in your voice
4. **Recruiter search** — The tool calls the LinkedIn MCP server directly to list employees, then a single Claude call ranks the candidates and picks up to 3 contacts (recruiter, alum, engineer). Runs in parallel with cover letter generation.
5. **Connection notes** — A ≤280-char LinkedIn connection request note generated for each contact (in parallel)
6. **Persist** — Everything saved to Supabase (deduplicates by URL)

```
jobreach list
```

Shows all tracked applications, most recent first, with status.

```
jobreach qa [url] [question]
```

Looks up an already-tracked job and answers an application question in your voice. Run without arguments (or with `--pick`) to interactively select from your tracked jobs.

```
jobreach connect [--yes] [--regen]
```

Pick a tracked job and send LinkedIn connection requests to its saved contacts. Shows each contact's saved connection note with a confirm prompt before sending. `--regen` regenerates notes fresh; `--yes` skips all confirmations.

---

## Prerequisites

- **Node.js 18+**
- **[uv](https://docs.astral.sh/uv/)** — Python package manager (for the LinkedIn MCP server)
- **Supabase account** — [supabase.com](https://supabase.com), free tier is fine
- **Claude Code** — the tool uses your existing Claude Code subscription via `@anthropic-ai/claude-agent-sdk`; no separate Anthropic API key is needed

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

Open `.env` and fill in your Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key_here
```

### 3. Personalize the output (two layers)

There are two layers of personalization, both git-ignored. The repo ships `.example` templates for each — copy them, then edit.

**Layer 1 — identity (small, structured):**

```bash
cp jobreach.config.example.json jobreach.config.json
```

Open `jobreach.config.json` and fill in your first name, school (if you're a student), and grad month. If you're not a student, remove the `school` and `gradMonth` lines — the tool drops the new-grad framing and the alumni-search slot becomes a generalist recruiter search.

**Layer 2 — voice and background (long-form):**

```bash
cp context/me.example.md           context/me.md
cp context/resume.example.md       context/resume.md
cp context/writing-samples.example.md context/writing-samples.md
cp context/targets.example.md      context/targets.md
```

Edit each file in place. All four are read at startup and concatenated into the system prompt for every generation. You can skip any of them — the tool just loads what's present. If you skip all four, you'll get a one-line warning and generic output.

The most important file is `context/me.md` — it sets the voice rules the AI follows (no em-dashes, no semicolons, short sentences, plain facts) plus your bio and projects.

### 4. Initialize the database

In your Supabase dashboard, open the **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates three tables (`jobs`, `contacts`, `messages`) with the right indexes and triggers.

### 5. Install the LinkedIn MCP server

```bash
uv tool install linkedin-scraper-mcp
```

### 6. Log in to LinkedIn

```bash
uv tool run linkedin-scraper-mcp --login
```

This opens a browser for you to log in. Your session is saved locally and reused on subsequent runs. The LinkedIn scraper is what lets the tool find recruiters — skip this step and contact discovery will be skipped.

### 7. Build

```bash
npm run build
```

### 8. Link globally

```bash
npm link
```

Now `jobreach` is available anywhere in your terminal.

> **If you edit `context/*.md` or `jobreach.config.json` later**, you don't need to rebuild — they're read at runtime. You only need to rerun `npm run build` if you change TypeScript source.

> **If the tool says "No context files found"** when run globally, you probably haven't rebuilt since pulling. Run `npm run build` once and the linked binary will pick up the latest path resolution.

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

Running the same URL twice is a no-op — the tool checks Supabase before doing any work. Add `--connect` to automatically send LinkedIn connection requests immediately after saving.

### List tracked jobs

```bash
jobreach list
```

### Send LinkedIn connection requests

```bash
jobreach connect          # pick a job, review each note, confirm per contact
jobreach connect --yes    # skip confirmations, send all
jobreach connect --regen  # regenerate notes before sending
```

### Answer an application question

```bash
jobreach qa --pick                                          # interactive job picker
jobreach qa "https://..." "What's a challenge you've overcome?"
```

The job must already exist in Supabase (added via `jobreach add`). The answer is written in first person using the stored job context and your personal background.

---

## Personalizing output

All generated text — cover letters, connection notes, application answers — is grounded in two layers of personal config, both git-ignored:

| File | Purpose |
|---|---|
| `jobreach.config.json` | Identity: name, school, grad month. Templated into every prompt. |
| `context/me.md` | Bio, voice rules, writing style. The canonical voice anchor. |
| `context/resume.md` | Specific bullets, metrics, dates, stacks. |
| `context/writing-samples.md` | Real cover letters and connection notes for tone calibration. |
| `context/targets.md` | What kinds of roles and companies you want. |

Each ships as a `.example` template in the repo. Copy and edit (see Setup step 3). Files are read at startup — no rebuild needed after editing.

If `jobreach.config.json` is missing the tool warns and falls back to generic placeholders. If all `context/*.md` files are missing the tool warns and generates with a generic stub bio. Partial config is fine: drop `school` or `gradMonth` from the config to disable alumni-search and new-grad framing respectively.

---

## Commands reference

| Command | Arguments | Description |
|---|---|---|
| `jobreach add` | `<url> [--connect]` | Scrape a job, generate cover letter + connection notes, save to Supabase |
| `jobreach list` | — | Show all tracked applications, newest first |
| `jobreach qa` | `[url] [question] [--pick]` | Answer an application question for a tracked job |
| `jobreach connect` | `[--yes] [--regen]` | Send LinkedIn connection requests for a tracked job |

---

## Database schema

Three tables in Supabase:

| Table | What it stores |
|---|---|
| `jobs` | Job postings — title, company, description, requirements, cover letter, status |
| `contacts` | Recruiters found per job — name, title, LinkedIn URL, role type, connection note |
| `messages` | Connection notes per contact — content, platform, draft/sent/replied status |

Job status can be: `pending` → `applied` → `interview` → `offer` / `rejected`. Currently managed manually in Supabase; no CLI command for status updates yet.

---

## Tech stack

| Piece | What it does |
|---|---|
| `commander` | CLI argument parsing |
| `playwright` | Headless browser scraping |
| `@anthropic-ai/claude-agent-sdk` | Drives Claude for cover letter, connection notes, Q&A, and the single ranking call for contact discovery |
| `@modelcontextprotocol/sdk` | TypeScript MCP client used to call the LinkedIn server directly (no LLM in the loop for scrape / send) |
| `linkedin-scraper-mcp` | LinkedIn scraper exposed as an MCP server (Python, run via `uv`) |
| `@supabase/supabase-js` | Persistence |
| `ora` + `chalk` | Terminal output |
| `tsup` | Build (ESM output) |
