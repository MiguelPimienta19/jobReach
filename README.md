# jobreach

A CLI tool that turns a job posting URL into a cover letter, personalized LinkedIn connection notes, and a database of every application — in under a minute.

## How it works

```
jobreach add <url>
```

1. **Scrape** — Playwright fetches the job posting (handles JS-rendered pages)
2. **Parse** — Claude extracts title, company, description, requirements, location
3. **Cover letter** — Claude writes a targeted cover letter in your voice
4. **Recruiter search** — A Claude agent uses the LinkedIn MCP server to find recruiters and university recruiters at the company (runs in parallel with cover letter generation)
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

### 3. Initialize the database

In your Supabase dashboard, open the **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates three tables (`jobs`, `contacts`, `messages`) with the right indexes and triggers.

### 4. Install the LinkedIn MCP server

```bash
uv tool install linkedin-scraper-mcp
```

### 5. Log in to LinkedIn

```bash
uv tool run linkedin-scraper-mcp --login
```

This opens a browser for you to log in. Your session is saved locally and reused on subsequent runs. The LinkedIn scraper is what lets the tool find recruiters — skip this step and contact discovery will be skipped.

### 6. Build

```bash
npm run build
```

### 7. Link globally

```bash
npm link
```

Now `jobreach` is available anywhere in your terminal.

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

## Personalizing output with `context/me.md`

All generated text — cover letters, connection notes, application answers — is grounded in your background. By default, the tool falls back to a hardcoded stub. To use your own information, create `context/me.md` (this file is git-ignored):

```
context/
└── me.md   ← create this, it's git-ignored
```

Suggested structure:

```markdown
# About me

[2-3 sentences: name, school/company, graduation date or years of experience]

# Projects

**Project Name** — [one sentence: what it is, what it won or achieved]
**Project Name** — [one sentence]

# Stack

[comma-separated list of languages, frameworks, tools]

# Writing voice

[optional: describe how you write — e.g. "direct and confident, no filler phrases, not overly formal"]
```

The file is read at startup. No re-build needed after editing it.

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
| `@anthropic-ai/claude-agent-sdk` | Drives Claude for generation + LinkedIn agent loop |
| `linkedin-scraper-mcp` | MCP server the agent uses to search LinkedIn |
| `@supabase/supabase-js` | Persistence |
| `ora` + `chalk` | Terminal output |
| `tsup` | Build (ESM output) |
